import type { CreationItem } from '../types/studio';

const DB_NAME = 'vesper_studio_db';
const DB_VERSION = 1;
const STORE_NAME = 'creations';

interface StoredCreationRecord extends Omit<CreationItem, 'mediaUrl'> {
  mediaDataUrl?: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open creations database'));
  });
}

export async function saveCreation(item: CreationItem): Promise<void> {
  const db = await openDatabase();
  const record: StoredCreationRecord = {
    id: item.id,
    kind: item.kind,
    sourceMode: item.sourceMode,
    prompt: item.prompt,
    style: item.style,
    aspectRatio: item.aspectRatio,
    width: item.width,
    height: item.height,
    duration: item.duration,
    cameraMotion: item.cameraMotion,
    quality: item.quality,
    engineLabel: item.engineLabel,
    mimeType: item.mimeType,
    createdAt: item.createdAt,
    blob: item.blob,
    mediaDataUrl: item.blob ? undefined : item.mediaUrl,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to save creation'));
    };
  });
}

export async function loadCreations(): Promise<CreationItem[]> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => {
        const records = Array.isArray(request.result)
          ? (request.result as StoredCreationRecord[])
          : [];
        records.sort((a, b) => (b?.createdAt ?? 0) - (a?.createdAt ?? 0));
        const items: CreationItem[] = records
          .filter((rec) => Boolean(rec && typeof rec.id === 'string'))
          .map((rec) => {
            const mediaUrl = rec.blob
              ? URL.createObjectURL(rec.blob)
              : rec.mediaDataUrl || '';
            return {
              ...rec,
              prompt: rec.prompt || '',
              mimeType:
                rec.mimeType || (rec.kind === 'image' ? 'image/jpeg' : 'video/mp4'),
              createdAt: rec.createdAt || Date.now(),
              mediaUrl,
            };
          });
        db.close();
        resolve(items);
      };
      request.onerror = () => {
        db.close();
        reject(request.error ?? new Error('Failed to read creations'));
      };
    });
  } catch {
    return [];
  }
}

export async function deleteCreation(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to delete creation'));
    };
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  if (typeof dataUrl !== 'string' || !dataUrl.includes(',')) {
    return new Blob([], { type: 'application/octet-stream' });
  }
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = header?.match(/data:([^;]+);/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  if (!base64) {
    return new Blob([], { type: mime });
  }
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}
