// Facade over ./generated/blocks/image.js — edit the source there.
export {
  isImagePath,
  mimeFromExt,
  resolveImagePath,
  buildImageAttachment,
  extractImagesFromInput,
  normalizeDroppedPath,
  encodeImagesForDispatch,
  attachVisionToMessages,
  visionSupportNote,
  decodeDataUrlToImageFile,
  parseImageDimensions,
  sniffImageMime,
  MAX_DISPATCH_IMAGES,
  MAX_DISPATCH_IMAGE_BYTES,
} from './generated/blocks/image.js';
export type { DataUrlImageResult, ImageDimensions } from './generated/blocks/image.js';
