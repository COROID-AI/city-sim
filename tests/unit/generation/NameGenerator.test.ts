import { createRng } from '@/generation/random';
import { NameGenerator } from '@/generation/NameGenerator';

describe('NameGenerator', () => {
  it('produces non-empty output for a fixed seed', () => {
    const rng = createRng(42);
    const names = new NameGenerator(rng);
    for (let i = 0; i < 200; i++) {
      const out = names.generate();
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = new NameGenerator(createRng(123));
    const b = new NameGenerator(createRng(123));
    for (let i = 0; i < 50; i++) {
      expect(a.generate()).toBe(b.generate());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = new NameGenerator(createRng(1));
    const b = new NameGenerator(createRng(2));
    const a1 = a.generate();
    const b1 = b.generate();
    // Not strictly guaranteed to differ on first call, but overwhelmingly
    // likely with the word lists in play. Use a small loop to harden.
    let differs = a1 !== b1;
    for (let i = 0; i < 10 && !differs; i++) {
      if (a.generate() !== b.generate()) differs = true;
    }
    expect(differs).toBe(true);
  });

  it('generateForKind(park) always contains the word Park', () => {
    const rng = createRng(7);
    const names = new NameGenerator(rng);
    for (let i = 0; i < 50; i++) {
      expect(names.generateForKind('park')).toMatch(/Park/);
    }
  });

  it('generateCompany() never returns an empty string', () => {
    const rng = createRng(8);
    const names = new NameGenerator(rng);
    for (let i = 0; i < 200; i++) {
      const out = names.generateCompany();
      expect(out.length).toBeGreaterThan(0);
    }
  });
});
