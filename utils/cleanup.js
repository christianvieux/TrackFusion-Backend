import fs from 'fs/promises'
import path from "path";
import os from "os";

export const cleanupFiles = async (files=[]) => {
    if (!files) return;
    
    const filesToDelete = Array.isArray(files) ? files : [files];
    await Promise.all(filesToDelete.map(async file => {
      if (file?.path) {
        try {
          await fs.promises.unlink(file.path);
        } catch (err) {
          console.error(`Failed to delete file ${file.path}:`, err);
        }
      }
    }));
  };