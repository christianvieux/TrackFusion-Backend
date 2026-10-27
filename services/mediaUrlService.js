import { s3Service } from "./s3Service.js";

export async function authorizeMediaReference(reference) {
  if (!reference) return reference;
  return s3Service.generateSecureUrl(reference, 3600);
}

export async function authorizeTrackArtwork(track) {
  if (!track?.image_url) return track;
  return {
    ...track,
    image_url: await authorizeMediaReference(track.image_url),
  };
}

export function authorizeTrackArtworkList(tracks) {
  return Promise.all(tracks.map(authorizeTrackArtwork));
}
