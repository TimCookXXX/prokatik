// Маленький LRU без срока жизни: индекс неизменен, пока жив процесс.

export class Lru<K, V> {
  private map = new Map<K, V>();

  constructor(private max: number) {}

  get(k: K): V | undefined {
    const v = this.map.get(k);
    if (v === undefined) return undefined;
    this.map.delete(k);
    this.map.set(k, v); // освежить позицию
    return v;
  }

  set(k: K, v: V): void {
    this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as K);
  }

  get size(): number {
    return this.map.size;
  }
}
