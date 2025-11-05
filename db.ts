import { Scene } from './types';

// Fix: Implement a vanilla IndexedDB wrapper to handle data persistence without external libraries.
const DB_NAME = 'ai-video-generator';
const DB_VERSION = 1;
const SCENES_STORE = 'scenes';

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      db.createObjectStore(SCENES_STORE, { keyPath: 'id' });
    };
  });
};

export const db = {
  async getAll(): Promise<Scene[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SCENES_STORE, 'readonly');
      const store = transaction.objectStore(SCENES_STORE);
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  },

  async put(scene: Scene): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SCENES_STORE, 'readwrite');
      const store = transaction.objectStore(SCENES_STORE);
      const request = store.put(scene);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  },

  async bulkPut(scenes: Scene[]): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(SCENES_STORE, 'readwrite');
        const store = transaction.objectStore(SCENES_STORE);
        scenes.forEach(scene => store.put(scene));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
  },

  async delete(id: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SCENES_STORE, 'readwrite');
      const store = transaction.objectStore(SCENES_STORE);
      const request = store.delete(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  },

  async clear(): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SCENES_STORE, 'readwrite');
      const store = transaction.objectStore(SCENES_STORE);
      const request = store.clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
};
