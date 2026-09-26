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

  function assertPngFile(fileReference) {
    var name = String(fileReference.name || "").toLowerCase();
    var opened = false;
    var previousEncoding = fileReference.encoding;
    var header;
    var expected = [137, 80, 78, 71, 13, 10, 26, 10];
    var index;
    if (!/\.png$/.test(name)) {
      raiseHostError("UNSUPPORTED_IMAGE_FILE", "Only PNG files are supported in the current Mock import phase.");
    }
    try {
      fileReference.encoding = "BINARY";
      opened = fileReference.open("r");
      if (!opened) raiseHostError("IMAGE_FILE_NOT_FOUND", "The generated image file could not be opened.");
      header = fileReference.read(8);
      if (!header || header.length !== 8) raiseHostError("INVALID_PNG", "The generated PNG file is empty or truncated.");
      for (index = 0; index < expected.length; index += 1) {
        if ((header.charCodeAt(index) & 255) !== expected[index]) {
          raiseHostError("INVALID_PNG", "The generated image does not contain a valid PNG signature.");
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

  api.importImage = function importImage(filePath) {
    var targetDocument = null;
    var sourceDocument = null;
    var sourceLayer = null;
    var importedLayer = null;
    var fileReference = null;
    var layerName = null;
    var layerCountBefore = 0;
    try {
      if (!filePath) return failure("IMPORT_SOURCE_MISSING", "Image file path is required.");
      if (app.documents.length === 0) return failure("NO_PHOTOSHOP_DOCUMENT", "No Photoshop document is open.");

      fileReference = new File(String(filePath));
      if (!fileReference.exists) return failure("IMAGE_FILE_NOT_FOUND", "The generated image file does not exist.");
      assertPngFile(fileReference);

      targetDocument = app.activeDocument;
      layerName = nextGeneratedLayerName(targetDocument);
      layerCountBefore = countLayers(targetDocument.layers);

      try {
        sourceDocument = app.open(fileReference);
      } catch (openError) {
        raiseHostError("PHOTOSHOP_IMPORT", "Photoshop could not open the generated PNG file.");
      }
      if (!sourceDocument || !sourceDocument.layers || sourceDocument.layers.length === 0) {
        raiseHostError("PHOTOSHOP_IMPORT", "The generated PNG document contains no image layer.");
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

      if (countLayers(targetDocument.layers) !== layerCountBefore + 1) {
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
        layerName: String(importedLayer.name),
        layerType: String(importedLayer.typename || "ArtLayer"),
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

  api.importSmartObjectToBounds = function importSmartObjectToBounds(filePath, targetLeft, targetTop, targetWidth, targetHeight) {
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
      assertPngFile(fileReference);

      targetDocument = app.activeDocument;
      layerName = nextGeneratedLayerName(targetDocument);
      layerCountBefore = countLayers(targetDocument.layers);
      try { sourceDocument = app.open(fileReference); }
      catch (openError) { raiseHostError("SMART_OBJECT_IMPORT_FAILED", "Photoshop could not open the generated PNG for Smart Object import."); }
      if (!sourceDocument || !sourceDocument.layers || sourceDocument.layers.length === 0) {
        raiseHostError("SMART_OBJECT_IMPORT_FAILED", "The generated PNG contains no image layer.");
      }
      sourceWidth = pixels(sourceDocument.width);
      sourceHeight = pixels(sourceDocument.height);
      if (!(sourceWidth > 0 && sourceHeight > 0)) raiseHostError("SMART_OBJECT_IMPORT_FAILED", "The generated PNG dimensions are invalid.");
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
      if (countLayers(targetDocument.layers) !== layerCountBefore + 1) {
        raiseHostError("SMART_OBJECT_IMPORT_FAILED", "Photoshop did not create exactly one Smart Object layer.");
      }
      return success({
        imported: true,
        layerName: String(importedLayer.name),
        layerType: String(importedLayer.kind || importedLayer.typename || "SmartObject"),
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

  api._nextGeneratedLayerNameFromNames = nextGeneratedLayerNameFromNames;
}(PSAIImageHubCompatHost));
