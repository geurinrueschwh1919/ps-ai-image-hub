(function defineImagePayloadOptimizer(root, factory) {
  "use strict";
  var imageInputs = typeof module === "object" && module.exports ? require("./imageInputSet") : root.PSAIImageHubCompat;
  var api = factory(imageInputs, root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createImagePayloadOptimizer(imageInputs, runtimeRoot) {
  "use strict";

  // Plugin-owned conservative target. This is not a documented GRS service limit.
  var PLUGIN_SOFT_PAYLOAD_TARGET = 16 * 1024 * 1024;
  var IMAGE_OPTIMIZATION_PROFILES = Object.freeze({
    pass1: Object.freeze({
      main: Object.freeze({ maxDimension: 2560, jpegQuality: 0.92 }),
      reference: Object.freeze({ maxDimension: 2048, jpegQuality: 0.90 })
    }),
    pass2: Object.freeze({
      main: Object.freeze({ maxDimension: 2048, jpegQuality: 0.88 }),
      reference: Object.freeze({ maxDimension: 1600, jpegQuality: 0.85 })
    })
  });

  function now() { return Date.now(); }

  function rawApiValue(image) {
    if (!image) return "";
    if (typeof image.url === "string" && /^https?:\/\//i.test(image.url)) return image.url;
    var value = image.apiValue || image.base64 || "";
    var match = String(value).match(/^data:[^;,]+;base64,([\s\S]*)$/i);
    return (match ? match[1] : String(value)).replace(/\s+/g, "");
  }

  function estimateImagePayloadBytes(inputSet) {
    return JSON.stringify(imageInputs.orderedImageInputs(inputSet).map(rawApiValue)).length;
  }

  function encodedBytes(image) { return rawApiValue(image).length; }

  function decodedBytes(image) {
    var value = rawApiValue(image);
    if (!value) return 0;
    var padding = /==$/.test(value) ? 2 : /=$/.test(value) ? 1 : 0;
    return Math.max(0, Math.floor(value.length * 3 / 4) - padding);
  }

  function dimensions(image, role, index) {
    return {
      role: role,
      index: index,
      width: Number(image && image.width) || null,
      height: Number(image && image.height) || null
    };
  }

  function cloneInputSet(inputSet) {
    var set = imageInputs.createImageInputSet(inputSet);
    return {
      mainImage: set.mainImage ? Object.assign({}, set.mainImage) : null,
      referenceImages: set.referenceImages.map(function clone(image) { return Object.assign({}, image); })
    };
  }

  function targetDimensions(width, height, maxDimension) {
    var sourceWidth = Number(width) || 0;
    var sourceHeight = Number(height) || 0;
    var longest = Math.max(sourceWidth, sourceHeight);
    if (!sourceWidth || !sourceHeight || !longest || longest <= maxDimension) {
      return { width: sourceWidth || null, height: sourceHeight || null, resized: false };
    }
    var scale = maxDimension / longest;
    return {
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale)),
      resized: true
    };
  }

  function canvasCodec(root) {
    function createCanvas() {
      if (!root.document || typeof root.document.createElement !== "function") return null;
      return root.document.createElement("canvas");
    }

    function loadImage(source) {
      return new Promise(function load(resolve, reject) {
        if (typeof root.Image !== "function") { reject(new Error("CEP Image decoder is unavailable.")); return; }
        var image = new root.Image();
        image.onload = function loaded() { resolve(image); };
        image.onerror = function failed() { reject(new Error("API input image could not be decoded.")); };
        image.src = source;
      });
    }

    function transparencyState(context, width, height) {
      try {
        var pixels = context.getImageData(0, 0, width, height).data;
        for (var offset = 3; offset < pixels.length; offset += 4) if (pixels[offset] !== 255) return true;
        return false;
      } catch (error) {
        // Unknown means PNG must stay PNG; never claim alpha detection without pixel access.
        return null;
      }
    }

    return {
      async transform(source, profile) {
        var raw = rawApiValue(source);
        if (!raw || (source.url && /^https?:\/\//i.test(source.url))) return Object.assign({}, source);
        var declaredMime = String(source.mimeType || "image/png").toLowerCase();
        var dataUrl = /^data:/i.test(source.apiValue || source.base64 || "")
          ? String(source.apiValue || source.base64)
          : "data:" + declaredMime + ";base64," + raw;
        var decoded = await loadImage(dataUrl);
        var sourceWidth = Number(source.width) || decoded.naturalWidth || decoded.width;
        var sourceHeight = Number(source.height) || decoded.naturalHeight || decoded.height;
        var sent = targetDimensions(sourceWidth, sourceHeight, profile.maxDimension);
        var canvas = createCanvas();
        if (!canvas || !sent.width || !sent.height) throw new Error("CEP Canvas encoder is unavailable.");
        canvas.width = sent.width;
        canvas.height = sent.height;
        var context = canvas.getContext("2d");
        if (!context) throw new Error("CEP Canvas 2D context is unavailable.");
        context.drawImage(decoded, 0, 0, sent.width, sent.height);
        var hasAlpha = declaredMime === "image/png" ? transparencyState(context, sent.width, sent.height) : false;
        var outputMime = declaredMime === "image/png" && hasAlpha !== false ? "image/png" : "image/jpeg";
        var encodeStartedAt = now();
        var output = canvas.toDataURL(outputMime, outputMime === "image/jpeg" ? profile.jpegQuality : undefined);
        var encodeMs = now() - encodeStartedAt;
        var match = String(output || "").match(/^data:[^;,]+;base64,([\s\S]+)$/i);
        if (!match) throw new Error("CEP Canvas returned an invalid image payload.");
        return Object.assign({}, source, {
          width: sent.width,
          height: sent.height,
          mimeType: outputMime,
          base64: match[1],
          apiValue: match[1],
          apiTemporaryCopy: true,
          optimization: {
            resized: sent.resized,
            jpegQuality: outputMime === "image/jpeg" ? profile.jpegQuality : null,
            alphaDetection: declaredMime === "image/png" ? (hasAlpha === null ? "unknown-preserved" : hasAlpha ? "alpha-preserved" : "no-alpha-converted") : "not-applicable",
            encodeMs: encodeMs
          }
        });
      }
    };
  }

  function imageMetrics(set) {
    var ordered = imageInputs.orderedImageInputs(set);
    return ordered.map(function metric(image, index) {
      var role = set.mainImage && index === 0 ? "main" : "reference";
      return Object.assign(dimensions(image, role, role === "main" ? 0 : index - (set.mainImage ? 1 : 0)), {
        encodedBytes: encodedBytes(image),
        mimeType: image && image.mimeType || null
      });
    });
  }

  async function transformSet(set, profile, codec, roles) {
    var output = cloneInputSet(set);
    var encodeMs = 0;
    if (roles.main && output.mainImage) {
      output.mainImage = await codec.transform(output.mainImage, profile.main, { role: "main", index: 0 });
      encodeMs += Number(output.mainImage.optimization && output.mainImage.optimization.encodeMs) || 0;
    }
    if (roles.reference) {
      for (var index = 0; index < output.referenceImages.length; index += 1) {
        output.referenceImages[index] = await codec.transform(output.referenceImages[index], profile.reference, { role: "reference", index: index });
        encodeMs += Number(output.referenceImages[index].optimization && output.referenceImages[index].optimization.encodeMs) || 0;
      }
    }
    return { imageInputs: output, encodeMs: encodeMs };
  }

  function constrainedProfile(profile, constraints) {
    var maxDimension = Number(constraints && constraints.maxDimension) || 0;
    function role(value) {
      return Object.assign({}, value, {
        maxDimension: maxDimension > 0 ? Math.min(value.maxDimension, maxDimension) : value.maxDimension
      });
    }
    return { main: role(profile.main), reference: role(profile.reference) };
  }

  function exceedsInputConstraints(set, constraints) {
    var maxDimension = Number(constraints && constraints.maxDimension) || 0;
    var maxBytes = Number(constraints && constraints.maxBytesPerImage) || 0;
    return imageInputs.orderedImageInputs(set).some(function exceeds(image) {
      var width = Number(image && image.width) || 0;
      var height = Number(image && image.height) || 0;
      return maxDimension > 0 && Math.max(width, height) > maxDimension ||
        maxBytes > 0 && decodedBytes(image) > maxBytes;
    });
  }

  class ImagePayloadOptimizer {
    constructor(options) {
      var settings = options || {};
      this.softTargetBytes = Number(settings.softTargetBytes) > 0 ? Number(settings.softTargetBytes) : PLUGIN_SOFT_PAYLOAD_TARGET;
      this.codec = settings.codec || canvasCodec(settings.runtimeRoot || runtimeRoot);
      this.now = settings.now || now;
    }

    async optimize(inputSet, constraints) {
      var sourceSet = imageInputs.createImageInputSet(inputSet);
      var untouchedCopy = cloneInputSet(sourceSet);
      var before = estimateImagePayloadBytes(sourceSet);
      var startedAt = this.now();
      var passCount = 0;
      var encodeMs = 0;
      var optimized = untouchedCopy;

      if (imageInputs.orderedImageInputs(sourceSet).length &&
          (before > this.softTargetBytes || exceedsInputConstraints(sourceSet, constraints))) {
        var pass1Profile = constrainedProfile(IMAGE_OPTIMIZATION_PROFILES.pass1, constraints);
        var pass2Profile = constrainedProfile(IMAGE_OPTIMIZATION_PROFILES.pass2, constraints);
        var pass1 = await transformSet(sourceSet, pass1Profile, this.codec, { main: true, reference: true });
        optimized = pass1.imageInputs;
        encodeMs += pass1.encodeMs;
        passCount = 1;

        if (estimateImagePayloadBytes(optimized) > this.softTargetBytes) {
          // Pass 2 protects the Main Image: references are reduced first.
          var referencePass = await transformSet(optimized, pass2Profile, this.codec, { main: false, reference: true });
          optimized = referencePass.imageInputs;
          encodeMs += referencePass.encodeMs;
          passCount = 2;
          if (estimateImagePayloadBytes(optimized) > this.softTargetBytes && optimized.mainImage) {
            var mainPass = await transformSet(optimized, pass2Profile, this.codec, { main: true, reference: false });
            optimized = mainPass.imageInputs;
            encodeMs += mainPass.encodeMs;
          }
        }
      }

      var after = estimateImagePayloadBytes(optimized);
      var sourceMetrics = imageMetrics(sourceSet);
      var sentMetrics = imageMetrics(optimized);
      var reduction = before > 0 ? Math.max(0, (before - after) / before * 100) : 0;
      return {
        imageInputs: optimized,
        metrics: {
          imageCount: sentMetrics.length,
          mainImageCount: optimized.mainImage ? 1 : 0,
          referenceCount: optimized.referenceImages.length,
          sourceDimensions: sourceMetrics.map(function source(item) { return { role: item.role, index: item.index, width: item.width, height: item.height }; }),
          sentDimensions: sentMetrics.map(function sent(item) { return { role: item.role, index: item.index, width: item.width, height: item.height }; }),
          encodedBytesPerImage: sentMetrics.map(function bytes(item) { return { role: item.role, index: item.index, bytes: item.encodedBytes, mimeType: item.mimeType }; }),
          beforeOptimizationPayloadBytes: before,
          afterOptimizationPayloadBytes: after,
          reductionPercent: Number(reduction.toFixed(1)),
          softTargetBytes: this.softTargetBytes,
          passCount: passCount,
          optimizeMs: this.now() - startedAt,
          encodeMs: encodeMs
        }
      };
    }
  }

  return {
    ImagePayloadOptimizer: ImagePayloadOptimizer,
    PLUGIN_SOFT_PAYLOAD_TARGET: PLUGIN_SOFT_PAYLOAD_TARGET,
    IMAGE_OPTIMIZATION_PROFILES: IMAGE_OPTIMIZATION_PROFILES,
    estimateImagePayloadBytes: estimateImagePayloadBytes,
    targetImageDimensions: targetDimensions,
    rawImageApiValue: rawApiValue,
    decodedImagePayloadBytes: decodedBytes,
    exceedsImageInputConstraints: exceedsInputConstraints
  };
}));
