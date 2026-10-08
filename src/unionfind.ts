export class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    let root = x;
    while (true) {
      const p = this.parent.get(root);
      if (p === undefined || p === root) break;
      root = p;
    }
    // Path compression.
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    if (!this.parent.has(root)) this.parent.set(root, root);
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // Smaller id wins so results do not depend on insertion order.
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }

  /** Groups of the given members, each sorted, ordered by their first member. */
  groups(members: Iterable<string>): string[][] {
    const byRoot = new Map<string, string[]>();
    for (const m of members) {
      const r = this.find(m);
      const g = byRoot.get(r);
      if (g) g.push(m);
      else byRoot.set(r, [m]);
    }
    return [...byRoot.values()].map((g) => [...new Set(g)].sort()).sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
  }
}
