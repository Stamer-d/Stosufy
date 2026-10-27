// The web app: the desktop app's stores (files of keys and values) kept in the browser's
// IndexedDB, which holds far more than localStorage (the playlists' offline copy is big)

const DATABASE = 'stosufy';
const STORE = 'stores';

let database: Promise<IDBDatabase> | null = null;
function open() {
	database ??= new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	return database;
}

async function run<T>(mode: IDBTransactionMode, use: (store: IDBObjectStore) => IDBRequest<T>) {
	const db = await open();
	return new Promise<T>((resolve, reject) => {
		const request = use(db.transaction(STORE, mode).objectStore(STORE));
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

class Store {
	constructor(private name: string) {}
	private key(key: string) {
		return `${this.name}/${key}`;
	}
	async get<T>(key: string): Promise<T | undefined> {
		return run('readonly', (store) => store.get(this.key(key)));
	}
	async set(key: string, value: unknown) {
		await run('readwrite', (store) => store.put(value, this.key(key)));
	}
	async delete(key: string) {
		await run('readwrite', (store) => store.delete(this.key(key)));
	}
	async clear() {
		await run('readwrite', (store) =>
			store.delete(IDBKeyRange.bound(`${this.name}/`, `${this.name}/￿`))
		);
	}
	/** (written right away already) */
	async save() {}
}

export async function load(name: string) {
	return new Store(name);
}
