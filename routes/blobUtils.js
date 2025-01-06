// Backend/utils/blobUtils.js

export function generateBlobName(index, value, context) {
  return `${context}-${index}/${value}`;
}