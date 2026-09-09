import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execa } from 'execa';

export interface ConsumerProject {
  cleanup: () => Promise<void>;
  root: string;
  /** Runs vitest inside the project and hands back the combined output. */
  test: () => Promise<{ exitCode: number; output: string }>;
  /** Runs `tsc --noEmit` inside the project and hands back the combined output. */
  typecheck: () => Promise<{ exitCode: number; output: string }>;
  write: (relativePath: string, contents: string) => Promise<void>;
}

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..');

/**
 * Packs this package exactly as `npm publish` would send it.
 *
 * Building first, because the tarball carries `dist` and nothing else — a stale
 * build would have the suite testing the previous commit.
 */
export async function packPackage(): Promise<string> {
  const output = join(await mkdtemp(join(tmpdir(), 'kysely-tester-pack-')), 'package.tgz');

  await execa('npm', ['run', 'build:dist'], { cwd: PACKAGE_ROOT });
  await execa('yarn', ['pack', '--out', output], { cwd: PACKAGE_ROOT });

  return output;
}

/**
 * Builds a throwaway package that depends on this one the way a real consumer
 * does — through a packed tarball in `node_modules`, not a workspace link.
 *
 * The distinction is the whole point. A link leaves this package's own
 * `node_modules` on disk, so TypeScript resolves `vitest` and `@electric-sql/pglite`
 * from there and quietly gets different nominal types than the consumer's, and a
 * bundler that treats linked source as its own will resolve dynamic imports that
 * are really Node's to resolve. Both hide breakage a published package would hit
 * on the first install.
 */
export async function createConsumerProject(tarball: string): Promise<ConsumerProject> {
  const root = await mkdtemp(join(tmpdir(), 'kysely-tester-consumer-'));

  async function write(relativePath: string, contents: string): Promise<void> {
    const target = join(root, relativePath);

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, 'utf8');
  }

  await write(
    'package.json',
    JSON.stringify(
      {
        name: 'consumer-fixture',
        private: true,
        type: 'module',
        dependencies: {
          '@electric-sql/pglite': getDevDependencyRange('@electric-sql/pglite'),
          '@planttheidea/kysely-tester': `file:${tarball}`,
          '@types/better-sqlite3': getDevDependencyRange('@types/better-sqlite3'),
          'better-sqlite3': getDevDependencyRange('better-sqlite3'),
          kysely: getDevDependencyRange('kysely'),
          typescript: getDevDependencyRange('typescript'),
          vitest: getDevDependencyRange('vitest'),
        },
      },
      null,
      2,
    ),
  );

  // `nodeLinker` matters: the breakage this suite exists to catch only appears
  // when the package sits in `node_modules` as its published self.
  await write('.yarnrc.yml', 'enableScripts: true\nnodeLinker: node-modules\n');
  await write('yarn.lock', '');

  await execa('yarn', ['install', '--no-immutable'], { cwd: root });

  async function run(command: string[]): Promise<{ exitCode: number; output: string }> {
    const result = await execa('yarn', command, { cwd: root, reject: false });

    return { exitCode: result.exitCode ?? 1, output: `${result.stdout}\n${result.stderr}` };
  }

  return {
    root,
    write,
    cleanup: () => rm(root, { force: true, recursive: true }),
    test: () => run(['vitest', 'run']),
    typecheck: () => run(['tsc', '--noEmit']),
  };
}

/**
 * Pins the consumer to the same versions this package develops against, so a
 * failure is about the package boundary rather than about a range resolving
 * somewhere new on the day the suite happened to run.
 */
function getDevDependencyRange(name: string): string {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
    devDependencies: Record<string, string>;
  };

  const range = manifest.devDependencies[name];

  if (!range) {
    throw new Error(`"${name}" is not a devDependency, so the consumer cannot pin to it.`);
  }

  return range;
}
