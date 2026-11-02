var PSAIImageHubCompatHost = PSAIImageHubCompatHost || {};

(function definePSAIImageHubCompatHost(api) {
  function quote(value) {
    return '"' + String(value)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t") + '"';
  }

  function encode(value) {
    var type = typeof value;
    var parts;
    var key;
    var index;
    if (value === null || value === undefined) return "null";
    if (type === "string") return quote(value);
    if (type === "number") return isFinite(value) ? String(value) : "null";
    if (type === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
      parts = [];
      for (index = 0; index < value.length; index += 1) parts.push(encode(value[index]));
      return "[" + parts.join(",") + "]";
    }
    if (type === "object") {
      parts = [];
      for (key in value) {
        if (value.hasOwnProperty(key)) parts.push(quote(key) + ":" + encode(value[key]));
      }
      return "{" + parts.join(",") + "}";
    }
    return "null";
  }

  function success(data) {
    return encode({ ok: true, data: data, error: null });
  }

  function failure(code, message) {
    return encode({ ok: false, data: null, error: { code: code, message: message } });
  }

  function raiseHostError(code, message) {
    var error = new Error(message);
    error.psaiCode = code;
    throw error;
  }

  function collectLayerNames(layers, names) {
    var result = names || [];
    var index;
    var layer;
    for (index = 0; index < layers.length; index += 1) {
      layer = layers[index];
      result.push(String(layer.name));
      if (layer.typename === "LayerSet" && layer.layers) collectLayerNames(layer.layers, result);
    }
    return result;
  }

  function nextGeneratedLayerNameFromNames(names) {
    var maximum = 0;
    var index;
    var match;
    var value;
    var suffix;
    for (index = 0; index < names.length; index += 1) {
      match = /^AI_Generated_(\d{3,})$/.exec(String(names[index]));
      if (match) {
        value = parseInt(match[1], 10);
        if (value > maximum) maximum = value;
      }
    }
    suffix = String(maximum + 1);
    while (suffix.length < 3) suffix = "0" + suffix;
    return "AI_Generated_" + suffix;
  }

  function nextGeneratedLayerName(documentReference) {
    return nextGeneratedLayerNameFromNames(collectLayerNames(documentReference.layers));
  }

  function countLayers(layers) {
    var total = 0;
    var index;
    var layer;
    for (index = 0; index < layers.length; index += 1) {
      total += 1;
      layer = layers[index];
      if (layer.typename === "LayerSet" && layer.layers) total += countLayers(layer.layers);
    }
    return total;
  }

  function documentId(documentReference) {
    try { return Number(documentReference.id); }
    catch (error) { return -1; }
  }

  function layerId(layerReference) {
    try { return Number(layerReference.id); }
    catch (error) { return -1; }
  }

  function collectLayerIds(layers, ids) {
    var result = ids || [];
    var index;
    var value;
    for (index = 0; layers && index < layers.length; index += 1) {
      value = layerId(layers[index]);
      if (value >= 0) result.push(value);
      if (layers[index].layers) collectLayerIds(layers[index].layers, result);
    }
    return result;
  }

  function addedLayerIds(before, after) {
    var known = {};
    var added = [];
    var index;
    for (index = 0; index < before.length; index += 1) known[String(before[index])] = true;
    for (index = 0; index < after.length; index += 1) {
      if (!known[String(after[index])]) added.push(after[index]);
    }
    return added;
  }

  function documentById(id) {
    var expected = Number(id);
    var index;
    if (!(expected >= 0)) return null;
    for (index = 0; index < app.documents.length; index += 1) {
      if (documentId(app.documents[index]) === expected) return app.documents[index];
    }
    return null;
  }

  function activateCompositeChannels(documentReference) {
    var components;
    if (!documentReference) return false;
    try {
      components = documentReference.componentChannels;
      if (!components || !components.length) return false;
      documentReference.activeChannels = components;
      return true;
    } catch (error) { return false; }
  }

  function activeChannelNames(documentReference) {
    var names = [];
    var channels;
    var index;
    try { channels = documentReference.activeChannels; }
    catch (error) { channels = []; }
    for (index = 0; channels && index < channels.length; index += 1) names.push(String(channels[index].name));
    return names;
  }

  function prepareImportTarget(expectedDocumentId) {
    var hasExpectedDocument = expectedDocumentId !== null && expectedDocumentId !== undefined && expectedDocumentId !== "" && Number(expectedDocumentId) >= 0;
    var target = hasExpectedDocument ? documentById(expectedDocumentId) : app.activeDocument;
    if (!target) raiseHostError("PHOTOSHOP_IMPORT_DOCUMENT_LOST", "The target Photoshop document is no longer open.");
    if (hasExpectedDocument) {
      app.activeDocument = target;
      if (!activateCompositeChannels(target)) {
        raiseHostError("PHOTOSHOP_IMPORT_CHANNEL_RESTORE_FAILED", "Photoshop could not restore the composite color channels before import.");
      }
      if (!target.activeLayer) raiseHostError("PHOTOSHOP_IMPORT_LAYER_STATE_INVALID", "Photoshop has no valid active layer for import.");
    }
    return target;
  }

  function assertSupportedImageFile(fileReference) {
    var name = String(fileReference.name || "").toLowerCase();
    var opened = false;
    var previousEncoding = fileReference.encoding;
    var header;
    var tail;
    var fileSize;
    var scanOffset;
    var chunkLength;
    var expectedPosition;
    var firstByteOfLaterChunk = -1;
    var foundJpegEndMarker = false;
    var isPngName = /\.png$/.test(name);
    var isJpegName = /\.jpe?g$/.test(name);
    var pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
    var detected = "";
    var index;
    if (!isPngName && !isJpegName) {
      raiseHostError("UNSUPPORTED_IMAGE_FILE", "Only PNG and JPEG generated image files are supported.");
    }
    try {
      fileReference.encoding = "BINARY";
      opened = fileReference.open("r");
      if (!opened) raiseHostError("IMAGE_FILE_NOT_FOUND", "The generated image file could not be opened.");
      header = fileReference.read(8);
      if (header && header.length >= 8) {
        detected = "png";
        for (index = 0; index < pngSignature.length; index += 1) {
          if ((header.charCodeAt(index) & 255) !== pngSignature[index]) { detected = ""; break; }
        }
      }
      if (!detected && header && header.length >= 3
          && (header.charCodeAt(0) & 255) === 255
          && (header.charCodeAt(1) & 255) === 216
          && (header.charCodeAt(2) & 255) === 255) detected = "jpeg";
      if (isPngName && !detected) {
        raiseHostError("INVALID_PNG", "The generated image does not contain a valid PNG signature.");
      }
      if (!detected || (isPngName && detected !== "png") || (isJpegName && detected !== "jpeg")) {
        raiseHostError("INVALID_IMAGE_FILE", "The generated image extension does not match its PNG or JPEG signature.");
      }
      if (detected === "jpeg") {
        fileReference.seek(0, 2);
        fileSize = fileReference.tell();
        if (!isFinite(fileSize) || fileSize < 4) {
          raiseHostError("INVALID_IMAGE_FILE", "The generated JPEG file is empty or truncated.");
        }
        scanOffset = 0;
        while (scanOffset < fileSize && !foundJpegEndMarker) {
          chunkLength = Math.min(65536, fileSize - scanOffset);
          expectedPosition = fileSize - scanOffset - chunkLength;
          fileReference.seek(scanOffset + chunkLength, 2);
          if (fileReference.tell() !== expectedPosition) break;
          tail = fileReference.read(chunkLength);
          if (!tail || tail.length !== chunkLength) break;
          if ((tail.charCodeAt(tail.length - 1) & 255) === 255 && firstByteOfLaterChunk === 217) {
            foundJpegEndMarker = true;
            break;
          }
          for (index = tail.length - 2; index >= 0; index -= 1) {
            if ((tail.charCodeAt(index) & 255) === 255 && (tail.charCodeAt(index + 1) & 255) === 217) {
              foundJpegEndMarker = true;
              break;
            }
          }
          firstByteOfLaterChunk = tail.charCodeAt(0) & 255;
          scanOffset += chunkLength;
        }
        if (!foundJpegEndMarker) {
          raiseHostError("INVALID_IMAGE_FILE", "The generated JPEG file is incomplete or corrupt.");
        }
      }
    } finally {
      if (opened) {
        try { fileReference.close(); }
        catch (closeError) {}
      }
      fileReference.encoding = previousEncoding;
    }
  }

  function pixels(value) {
    try { return Number(value.as("px")); }
    catch (error) { return Number(value); }
  }

  function layerBounds(layerReference) {
    var bounds = layerReference && layerReference.bounds;
    if (!bounds || bounds.length !== 4) return null;
    var left = pixels(bounds[0]);
    var top = pixels(bounds[1]);
    var right = pixels(bounds[2]);
    var bottom = pixels(bounds[3]);
    return { left: left, top: top, right: right, bottom: bottom, width: right - left, height: bottom - top };
  }

  function selectionBounds(documentReference) {
    var bounds;
    try { bounds = documentReference.selection.bounds; }
    catch (error) { raiseHostError("NO_PHOTOSHOP_SELECTION", "The current Photoshop document has no valid selection."); }
    if (!bounds || bounds.length !== 4) raiseHostError("NO_PHOTOSHOP_SELECTION", "The current Photoshop document has no valid selection.");
    return bounds;
  }

  function boundsObject(bounds) {
    return { left: pixels(bounds[0]), top: pixels(bounds[1]), right: pixels(bounds[2]), bottom: pixels(bounds[3]),
      width: pixels(bounds[2]) - pixels(bounds[0]), height: pixels(bounds[3]) - pixels(bounds[1]) };
  }

  api.ping = function ping() {
    return success({ message: "pong", bridgeVersion: "1.0" });
  };

  api.getHostCapabilities = function getHostCapabilities() {
    var hasApplication = false;
    var canReadDocuments = false;
    var canUseFiles = false;
    var canUsePng = false;
    var canPlaceLayers = false;
    try { hasApplication = typeof app !== "undefined"; } catch (error) { hasApplication = false; }
    try { canReadDocuments = hasApplication && app.documents !== undefined; } catch (error) { canReadDocuments = false; }
    try { canUseFiles = typeof File !== "undefined"; } catch (error) { canUseFiles = false; }
    try { canUsePng = typeof PNGSaveOptions !== "undefined"; } catch (error) { canUsePng = false; }
    try { canPlaceLayers = typeof ElementPlacement !== "undefined"; } catch (error) { canPlaceLayers = false; }
    return success({
      documentAccess: canReadDocuments,
      currentCanvasExport: canReadDocuments && canUseFiles && canUsePng,
      currentSelectionExport: canReadDocuments && canUseFiles && canUsePng,
      layerImport: canReadDocuments && canUseFiles && canPlaceLayers,
      tempDocumentWorkflow: canReadDocuments && canUseFiles,
      fileOpen: canUseFiles
    });
  };

  api.getPhotoshopVersion = function getPhotoshopVersion() {
    try { return success(String(app.version)); }
    catch (error) { return failure("PHOTOSHOP", "Could not read the Photoshop version."); }
  };

  api.hasOpenDocument = function hasOpenDocument() {
    try { return success(app.documents.length > 0); }
    catch (error) { return failure("PHOTOSHOP", "Could not inspect Photoshop documents."); }
  };

  api.getActiveDocumentName = function getActiveDocumentName() {
    try {
      if (app.documents.length === 0) return success(null);
      return success(String(app.activeDocument.name));
    } catch (error) {
      return failure("PHOTOSHOP", "Could not read the active document name.");
    }
  };

  api.getDocumentMetadata = function getDocumentMetadata() {
    var documentReference;
    var hasSelection = true;
    try {
      if (app.documents.length === 0) return failure("NO_PHOTOSHOP_DOCUMENT", "No Photoshop document is open.");
      documentReference = app.activeDocument;
      try { selectionBounds(documentReference); }
      catch (selectionError) { hasSelection = false; }
      return success({
        documentId: documentId(documentReference),
        name: String(documentReference.name),
        width: pixels(documentReference.width),
        height: pixels(documentReference.height),
        hasSelection: hasSelection
      });
    } catch (error) { return failure(error.psaiCode || "PHOTOSHOP", error.message || "Could not read document metadata."); }
  };

  api.getSelectionBounds = function getSelectionBounds() {
    var bounds;
    try {
      if (app.documents.length === 0) return failure("NO_PHOTOSHOP_DOCUMENT", "No Photoshop document is open.");
      bounds = selectionBounds(app.activeDocument);
      return success({
        left: pixels(bounds[0]), top: pixels(bounds[1]), right: pixels(bounds[2]), bottom: pixels(bounds[3]),
        width: pixels(bounds[2]) - pixels(bounds[0]), height: pixels(bounds[3]) - pixels(bounds[1])
      });
    } catch (error) { return failure(error.psaiCode || "PHOTOSHOP", error.message || "Could not read selection bounds."); }
  };

  api.exportReferenceImage = function exportReferenceImage(mode, filePath) {
    var sourceDocument = null;
    var temporaryDocument = null;
    var targetFile = null;
    var bounds = null;
    var width = 0;
    var height = 0;
    try {
      if (app.documents.length === 0) return failure("NO_PHOTOSHOP_DOCUMENT", "No Photoshop document is open.");
      if (mode !== "canvas" && mode !== "selection") return failure("REFERENCE_EXPORT_FAILED", "Unknown reference export mode.");
      if (!filePath) return failure("REFERENCE_EXPORT_FAILED", "Reference export path is required.");
      sourceDocument = app.activeDocument;
      if (mode === "selection") bounds = selectionBounds(sourceDocument);
      temporaryDocument = sourceDocument.duplicate("PSAI_Reference_Temporary");
      app.activeDocument = temporaryDocument;
      if (bounds) temporaryDocument.crop(bounds);
      if (temporaryDocument.layers && temporaryDocument.layers.length > 1) temporaryDocument.flatten();
      width = pixels(temporaryDocument.width);
      height = pixels(temporaryDocument.height);
      targetFile = new File(String(filePath));
      if (targetFile.exists) targetFile.remove();
      temporaryDocument.saveAs(targetFile, new PNGSaveOptions(), true, Extension.LOWERCASE);
      if (!targetFile.exists) raiseHostError("REFERENCE_EXPORT_FAILED", "Photoshop did not create the reference PNG.");
      return success({ path: String(targetFile.fsName || filePath), width: width, height: height, source: mode });
    } catch (error) {
      return failure(error.psaiCode || "REFERENCE_EXPORT_FAILED", error.message || "Photoshop reference export failed.");
    } finally {
      if (temporaryDocument) {
        try { temporaryDocument.close(SaveOptions.DONOTSAVECHANGES); }
        catch (closeError) {}
      }
      if (sourceDocument) {
        try { app.activeDocument = sourceDocument; }
        catch (restoreError) {}
      }
    }
  };

  api.importImage = function importImage(filePath, expectedDocumentId) {
    var targetDocument = null;
    var sourceDocument = null;
    var sourceLayer = null;
    var importedLayer = null;
    var fileReference = null;
    var layerName = null;
    var layerCountBefore = 0;
    var layerIdsBefore = [];
    var newLayerIds = [];
    try {
      if (!filePath) return failure("IMPORT_SOURCE_MISSING", "Image file path is required.");
      if (app.documents.length === 0) return failure("NO_PHOTOSHOP_DOCUMENT", "No Photoshop document is open.");

      fileReference = new File(String(filePath));
      if (!fileReference.exists) return failure("IMAGE_FILE_NOT_FOUND", "The generated image file does not exist.");
      assertSupportedImageFile(fileReference);

      targetDocument = prepareImportTarget(expectedDocumentId);
      layerName = nextGeneratedLayerName(targetDocument);
      layerCountBefore = countLayers(targetDocument.layers);
      layerIdsBefore = collectLayerIds(targetDocument.layers);

      try {
        sourceDocument = app.open(fileReference);
      } catch (openError) {
        raiseHostError("PHOTOSHOP_IMPORT", "Photoshop could not open the generated image file.");
      }
      if (!sourceDocument || !sourceDocument.layers || sourceDocument.layers.length === 0) {
        raiseHostError("PHOTOSHOP_IMPORT", "The generated image document contains no image layer.");
      }

      sourceLayer = sourceDocument.activeLayer || sourceDocument.layers[0];
      try { sourceLayer.name = layerName; }
      catch (renameSourceError) {
        raiseHostError("LAYER_RENAME_FAILED", "Photoshop could not prepare the generated layer name.");
      }

      try {
        importedLayer = sourceLayer.duplicate(targetDocument, ElementPlacement.PLACEATBEGINNING);
        app.activeDocument = targetDocument;
      } catch (duplicateError) {
        raiseHostError("PHOTOSHOP_IMPORT", "Photoshop could not duplicate the generated image into the current document.");
      }

      newLayerIds = addedLayerIds(layerIdsBefore, collectLayerIds(targetDocument.layers));
      if (countLayers(targetDocument.layers) !== layerCountBefore + 1 || layerIdsBefore.length > 0 && newLayerIds.length !== 1) {
        raiseHostError("PHOTOSHOP_IMPORT", "Photoshop did not create exactly one generated image layer.");
      }
      if (!importedLayer) importedLayer = targetDocument.activeLayer;
      if (!importedLayer) raiseHostError("PHOTOSHOP_IMPORT", "Photoshop did not return the imported image layer.");
      if (String(importedLayer.name) !== layerName) {
        try { importedLayer.name = layerName; }
        catch (renameImportedError) {
          raiseHostError("LAYER_RENAME_FAILED", "Photoshop created the image layer but could not apply its generated name.");
        }
      }

      return success({
        imported: true,
        layerId: layerId(importedLayer),
        addedLayerIds: newLayerIds,
        layerName: String(importedLayer.name),
        layerType: String(importedLayer.typename || "ArtLayer"),
        documentId: documentId(targetDocument),
        documentName: String(targetDocument.name),
        documentWidth: pixels(targetDocument.width),
        documentHeight: pixels(targetDocument.height),
        finalBounds: layerBounds(importedLayer),
        sourcePath: String(fileReference.fsName || filePath)
      });
    } catch (error) {
      return failure(error.psaiCode || "EXTENDSCRIPT_EXCEPTION", error.message || "Photoshop image import failed.");
    } finally {
      if (sourceDocument) {
        try { sourceDocument.close(SaveOptions.DONOTSAVECHANGES); }
        catch (closeSourceError) {}
      }
      if (targetDocument) {
        try { app.activeDocument = targetDocument; }
        catch (restoreError) {}
      }
    }
  };

  api.importSmartObjectToBounds = function importSmartObjectToBounds(filePath, targetLeft, targetTop, targetWidth, targetHeight, expectedDocumentId) {
    var targetDocument = null;
    var sourceDocument = null;
    var sourceLayer = null;
    var importedLayer = null;
    var fileReference = null;
    var layerName = null;
    var layerCountBefore = 0;
    var sourceWidth = 0;
    var sourceHeight = 0;
    var left = Number(targetLeft);
    var top = Number(targetTop);
    var width = Number(targetWidth);
    var height = Number(targetHeight);
    var scale = 1;
    var beforeBounds = null;
    var afterBounds = null;
    var finalBounds = null;
    var layerIdsBefore = [];
    var newLayerIds = [];
    var deltaX = 0;
    var deltaY = 0;
    try {
      if (!filePath) return failure("IMPORT_SOURCE_MISSING", "Image file path is required.");
      if (app.documents.length === 0) return failure("NO_PHOTOSHOP_DOCUMENT", "No Photoshop document is open.");
      if (!(isFinite(left) && isFinite(top) && width > 0 && height > 0)) {
        return failure("SMART_OBJECT_IMPORT_FAILED", "Smart Object import target bounds are invalid.");
      }
      fileReference = new File(String(filePath));
      if (!fileReference.exists) return failure("IMAGE_FILE_NOT_FOUND", "The generated image file does not exist.");
      assertSupportedImageFile(fileReference);

      targetDocument = prepareImportTarget(expectedDocumentId);
      layerName = nextGeneratedLayerName(targetDocument);
      layerCountBefore = countLayers(targetDocument.layers);
      layerIdsBefore = collectLayerIds(targetDocument.layers);
      try { sourceDocument = app.open(fileReference); }
      catch (openError) { raiseHostError("SMART_OBJECT_IMPORT_FAILED", "Photoshop could not open the generated image for Smart Object import."); }
      if (!sourceDocument || !sourceDocument.layers || sourceDocument.layers.length === 0) {
        raiseHostError("SMART_OBJECT_IMPORT_FAILED", "The generated image contains no image layer.");
      }
      sourceWidth = pixels(sourceDocument.width);
      sourceHeight = pixels(sourceDocument.height);
      if (!(sourceWidth > 0 && sourceHeight > 0)) raiseHostError("SMART_OBJECT_IMPORT_FAILED", "The generated image dimensions are invalid.");
      scale = Math.min(width / sourceWidth, height / sourceHeight);
      if (scale < 0.999999) raiseHostError("SMART_OBJECT_IMPORT_FAILED", "Smart Object upscale path cannot be used for a shrink operation.");

      sourceLayer = sourceDocument.activeLayer || sourceDocument.layers[0];
      sourceLayer.name = layerName;
      importedLayer = sourceLayer.duplicate(targetDocument, ElementPlacement.PLACEATBEGINNING);
      app.activeDocument = targetDocument;
      targetDocument.activeLayer = importedLayer;
      try {
        executeAction(stringIDToTypeID("newPlacedLayer"), undefined, DialogModes.NO);
        importedLayer = targetDocument.activeLayer;
      } catch (smartObjectError) {
        raiseHostError("SMART_OBJECT_IMPORT_FAILED", "Photoshop could not convert the generated layer to a Smart Object.");
      }
      if (!importedLayer) raiseHostError("SMART_OBJECT_IMPORT_FAILED", "Photoshop did not return the Smart Object layer.");
      importedLayer.name = layerName;
      beforeBounds = layerBounds(importedLayer);
      if (!beforeBounds || !(beforeBounds.width > 0 && beforeBounds.height > 0)) {
        raiseHostError("SMART_OBJECT_IMPORT_FAILED", "Photoshop could not read the Smart Object bounds.");
      }
      if (scale > 1.000001) {
        try { importedLayer.resize(scale * 100, scale * 100, AnchorPosition.MIDDLECENTER); }
        catch (resizeError) { raiseHostError("SMART_OBJECT_IMPORT_FAILED", "Photoshop could not scale the Smart Object to the target region."); }
      }
      afterBounds = layerBounds(importedLayer);
      if (!afterBounds) raiseHostError("SMART_OBJECT_IMPORT_FAILED", "Photoshop could not read the transformed Smart Object bounds.");
      deltaX = left + (width - afterBounds.width) / 2 - afterBounds.left;
      deltaY = top + (height - afterBounds.height) / 2 - afterBounds.top;
      try { importedLayer.translate(UnitValue(deltaX, "px"), UnitValue(deltaY, "px")); }
      catch (translateError) { raiseHostError("SMART_OBJECT_IMPORT_FAILED", "Photoshop could not align the Smart Object to the target region."); }
      finalBounds = layerBounds(importedLayer);
      if (!finalBounds) raiseHostError("SMART_OBJECT_IMPORT_FAILED", "Photoshop could not confirm the final Smart Object bounds.");
      newLayerIds = addedLayerIds(layerIdsBefore, collectLayerIds(targetDocument.layers));
      if (countLayers(targetDocument.layers) !== layerCountBefore + 1 || layerIdsBefore.length > 0 && newLayerIds.length !== 1) {
        raiseHostError("SMART_OBJECT_IMPORT_FAILED", "Photoshop did not create exactly one Smart Object layer.");
      }
      return success({
        imported: true,
        layerId: layerId(importedLayer),
        addedLayerIds: newLayerIds,
        layerName: String(importedLayer.name),
        layerType: String(importedLayer.kind || importedLayer.typename || "SmartObject"),
        documentId: documentId(targetDocument),
        documentName: String(targetDocument.name),
        documentWidth: pixels(targetDocument.width),
        documentHeight: pixels(targetDocument.height),
        sourceWidth: sourceWidth,
        sourceHeight: sourceHeight,
        appliedScale: scale,
        usedSmartObjectUpscale: scale > 1.000001,
        targetBounds: { left: left, top: top, right: left + width, bottom: top + height, width: width, height: height },
        finalBounds: finalBounds,
        sourcePath: String(fileReference.fsName || filePath)
      });
    } catch (error) {
      if (importedLayer) {
        try { importedLayer.remove(); }
        catch (removeError) {}
      }
      return failure(error.psaiCode || "SMART_OBJECT_IMPORT_FAILED", error.message || "Photoshop Smart Object import failed.");
    } finally {
      if (sourceDocument) {
        try { sourceDocument.close(SaveOptions.DONOTSAVECHANGES); }
        catch (closeSourceError) {}
      }
      if (targetDocument) {
        try { app.activeDocument = targetDocument; }
        catch (restoreError) {}
      }
    }
  };

  function findLayerByName(container, name) {
    var index;
    var layer;
    if (!container || !container.layers) return null;
    for (index = 0; index < container.layers.length; index += 1) {
      layer = container.layers[index];
      if (String(layer.name) === String(name)) return layer;
      if (layer.layers) {
        var nested = findLayerByName(layer, name);
        if (nested) return nested;
      }
    }
    return null;
  }

  function createRevealSelectionMask() {
    var descriptor = new ActionDescriptor();
    var newReference = new ActionReference();
    var maskReference = new ActionReference();
    newReference.putClass(charIDToTypeID("Chnl"));
    descriptor.putReference(charIDToTypeID("Nw  "), newReference);
    maskReference.putEnumerated(charIDToTypeID("Chnl"), charIDToTypeID("Chnl"), charIDToTypeID("Msk "));
    descriptor.putReference(charIDToTypeID("At  "), maskReference);
    descriptor.putEnumerated(charIDToTypeID("Usng"), charIDToTypeID("UsrM"), charIDToTypeID("RvlS"));
    executeAction(charIDToTypeID("Mk  "), descriptor, DialogModes.NO);
  }

  function directLayerByName(container, name, excludedLayer) {
    var index;
    var layer;
    if (!container || !container.layers) return null;
    for (index = 0; index < container.layers.length; index += 1) {
      layer = container.layers[index];
      if (layer !== excludedLayer && String(layer.name) === String(name)) return layer;
    }
    return null;
  }

  api.applyAutoSharpen = function applyAutoSharpen(layerName, blendMode, opacity, radius, isLocal, contract, feather, suppressColorFringing) {
    var targetDocument = null;
    var originalLayer = null;
    var sharpenLayer = null;
    var group = null;
    var oldSharpenLayer = null;
    var groupCreated = false;
    var originalSelection = null;
    var maskApplied = false;
    var replacedExisting = false;
    var safeRadius = Number(radius);
    var safeOpacity = Number(opacity);
    var safeContract = Math.max(0, Number(contract) || 0);
    var safeFeather = Math.max(0, Number(feather) || 0);
    var shouldDesaturate = suppressColorFringing === true || String(suppressColorFringing) === "true";
    try {
      if (!blendMode || blendMode === "none" || blendMode === "off") {
        return success({ applied: false, success: false, skipped: true, reason: "sharpening-disabled" });
      }
      if (app.documents.length === 0) return failure("NO_PHOTOSHOP_DOCUMENT", "No Photoshop document is open.");
      if (!(safeRadius >= 0.1 && safeRadius <= 10.0)) return failure("AUTO_SHARPEN_INVALID", "Auto sharpen radius is invalid.");
      if (!(safeOpacity >= 0 && safeOpacity <= 100)) return failure("AUTO_SHARPEN_INVALID", "Auto sharpen opacity is invalid.");
      if (blendMode !== "softLight" && blendMode !== "overlay" && blendMode !== "linearLight") return failure("AUTO_SHARPEN_INVALID", "Auto sharpen blend mode is invalid.");
      targetDocument = app.activeDocument;
      var targetIdentity = /^psai-layer:([0-9]+):([0-9]+)$/.exec(String(layerName));
      if (targetIdentity) {
        var expectedDocument = documentById(targetIdentity[1]);
        if (!expectedDocument) return failure("AUTO_SHARPEN_LAYER_MISSING", "The imported document is closed.");
        if (expectedDocument !== targetDocument) return failure("AUTO_SHARPEN_DOCUMENT_INACTIVE", "Activate the imported document before sharpening.");
        originalLayer = findLayerById(targetDocument, targetIdentity[2]);
      } else originalLayer = findLayerByName(targetDocument, layerName);
      if (!originalLayer) return failure("AUTO_SHARPEN_LAYER_MISSING", "The generated Photoshop layer could not be found.");

      if (originalLayer.parent && originalLayer.parent.typename === "LayerSet" &&
          String(originalLayer.parent.name) === "AI生成图_清晰化") {
        group = originalLayer.parent;
        oldSharpenLayer = directLayerByName(group, "AI生成图_锐化", originalLayer);
      }

      if (isLocal === true || String(isLocal) === "true") {
        originalSelection = selectionBounds(targetDocument);
        if (safeContract <= 0 || safeFeather <= 0) return failure("AUTO_SHARPEN_MASK_UNAVAILABLE", "Local auto sharpen requires edge protection.");
        if (pixels(originalSelection[2]) - pixels(originalSelection[0]) <= safeContract * 2 ||
            pixels(originalSelection[3]) - pixels(originalSelection[1]) <= safeContract * 2) {
          return failure("AUTO_SHARPEN_MASK_UNAVAILABLE", "The protected local sharpen selection is too small.");
        }
      }

      sharpenLayer = originalLayer.duplicate();
      sharpenLayer.name = "AI生成图_锐化_处理中";
      targetDocument.activeLayer = sharpenLayer;
      try { sharpenLayer.applyHighPass(safeRadius); }
      catch (highPassError) { raiseHostError("AUTO_SHARPEN_FAILED", "Photoshop could not apply High Pass."); }
      if (shouldDesaturate) {
        try { sharpenLayer.desaturate(); }
        catch (desaturateError) { raiseHostError("AUTO_SHARPEN_FAILED", "Photoshop could not desaturate the sharpen layer."); }
      }
      sharpenLayer.blendMode = blendMode === "softLight" ? BlendMode.SOFTLIGHT :
        (blendMode === "overlay" ? BlendMode.OVERLAY : BlendMode.LINEARLIGHT);
      sharpenLayer.opacity = safeOpacity;

      if (originalSelection) {
        try {
          targetDocument.selection.select([
            [pixels(originalSelection[0]) + safeContract, pixels(originalSelection[1]) + safeContract],
            [pixels(originalSelection[2]) - safeContract, pixels(originalSelection[1]) + safeContract],
            [pixels(originalSelection[2]) - safeContract, pixels(originalSelection[3]) - safeContract],
            [pixels(originalSelection[0]) + safeContract, pixels(originalSelection[3]) - safeContract]
          ]);
          targetDocument.selection.feather(safeFeather);
          createRevealSelectionMask();
          maskApplied = true;
        } catch (maskError) { raiseHostError("AUTO_SHARPEN_MASK_UNAVAILABLE", "Photoshop could not create the protected local sharpen mask."); }
        finally {
          try { targetDocument.selection.select([
            [pixels(originalSelection[0]), pixels(originalSelection[1])],
            [pixels(originalSelection[2]), pixels(originalSelection[1])],
            [pixels(originalSelection[2]), pixels(originalSelection[3])],
            [pixels(originalSelection[0]), pixels(originalSelection[3])]
          ]); } catch (restoreSelectionError) {}
        }
      }

      if (!group) {
        group = targetDocument.layerSets.add();
        group.name = "AI生成图_清晰化";
        groupCreated = true;
        originalLayer.move(group, ElementPlacement.INSIDE);
        sharpenLayer.move(group, ElementPlacement.INSIDE);
      }
      sharpenLayer.name = "AI生成图_锐化";
      if (oldSharpenLayer) {
        try {
          oldSharpenLayer.remove();
          oldSharpenLayer = null;
          replacedExisting = true;
        } catch (replaceError) {
          raiseHostError("AUTO_SHARPEN_REPLACE_FAILED", "Photoshop could not replace the previous sharpen layer.");
        }
      }
      targetDocument.activeLayer = sharpenLayer;
      return success({
        applied: true,
        originalLayerName: String(originalLayer.name),
        sharpenLayerName: String(sharpenLayer.name),
        groupName: String(group.name),
        radius: safeRadius,
        opacity: safeOpacity,
        blendMode: String(blendMode),
        suppressColorFringing: shouldDesaturate,
        replacedExisting: replacedExisting,
        maskApplied: maskApplied,
        contract: originalSelection ? safeContract : 0,
        feather: originalSelection ? safeFeather : 0
      });
    } catch (error) {
      if (originalLayer && groupCreated && group) {
        try { originalLayer.move(group, ElementPlacement.PLACEBEFORE); } catch (restoreLayerError) {}
      }
      if (sharpenLayer) { try { sharpenLayer.remove(); } catch (removeSharpenError) {} }
      if (groupCreated && group) { try { if (group.layers.length === 0) group.remove(); } catch (removeGroupError) {} }
      if (targetDocument && originalLayer) { try { targetDocument.activeLayer = originalLayer; } catch (restoreActiveError) {} }
      return failure(error.psaiCode || "AUTO_SHARPEN_FAILED", error.message || "Photoshop auto sharpen failed.");
    }
  };

  api._nextGeneratedLayerNameFromNames = nextGeneratedLayerNameFromNames;
}(PSAIImageHubCompatHost));
