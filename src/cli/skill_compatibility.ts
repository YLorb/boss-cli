import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COMPATIBILITY = Object.freeze({
  cliVersion: '0.6.11',
  skillVersion: '1.0.20',
  compatibilityId: '2026-10-30-resume-analysis-v1',
});
const installRoot = fileURLToPath(new URL('../../', import.meta.url));

// Only the quoted metadata fields used by this skill contract are accepted.
function metadata(source: string, key: string): string | null {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source)?.[1];
  if (!frontmatter) throw new Error('Skill 缺少有效 YAML frontmatter，无法校验版本');
  const block = /^metadata:\s*\r?\n((?:[ \t]+[^\n]*\n?|\r?\n)*)/m.exec(frontmatter)?.[1] ?? '';
  const lines = block.split(/\r?\n/).filter(line => new RegExp(`^  ${key}:`).test(line));
  if (lines.length === 0) return null;
  if (lines.length !== 1) throw new Error(`Skill metadata.${key} 重复，无法校验版本`);
  const value = new RegExp(`^  ${key}: ["']([^"']+)["']\\s*$`).exec(lines[0]);
  if (!value) throw new Error(`Skill metadata.${key} 格式错误，要求带引号的单行值`);
  return value[1];
}

export async function checkSkillCompatibility() {
  const selected = process.env.BOSS_SKILL_DIR ?? join(installRoot, 'skills', 'boss-recruitment');
  if (!isAbsolute(selected)) throw new Error('BOSS_SKILL_DIR 必须为实际加载 Skill 的绝对目录');
  const skillFile = await realpath(join(selected, 'SKILL.md'));
  const source = await readFile(skillFile, 'utf8');
  const cliVersion: unknown = JSON.parse(await readFile(join(installRoot, 'package.json'), 'utf8')).version;
  if (typeof cliVersion !== 'string' || !cliVersion) throw new Error('CLI package.json 缺少有效 version');
  const actual = {
    cliVersion,
    skillVersion: metadata(source, 'version'),
    skillCliVersion: metadata(source, 'cli-version'),
    compatibilityId: metadata(source, 'cli-compatibility'),
  };
  const compatible = actual.cliVersion === COMPATIBILITY.cliVersion
    && actual.skillVersion === COMPATIBILITY.skillVersion
    && actual.skillCliVersion === actual.cliVersion
    && actual.compatibilityId === COMPATIBILITY.compatibilityId;
  const confirmationToken = compatible ? null : createHash('sha256')
    .update(JSON.stringify({ skillFile, source, actual, expected: COMPATIBILITY })).digest('hex');
  return { compatible, requiresConfirmation: !compatible, skillDir: dirname(skillFile), actual, expected: COMPATIBILITY, confirmationToken };
}

export function splitVersionConfirmation(argv: string[]) {
  const flag = '--confirm-version-mismatch';
  const indexes = argv.flatMap((arg, index) => arg === flag ? [index] : []);
  if (indexes.length === 0) return { argv, confirmation: undefined };
  const index = indexes[0];
  if (indexes.length !== 1 || !/^[a-f0-9]{64}$/.test(argv[index + 1] ?? '')) {
    throw new Error(`${flag} 要求唯一且完整的版本确认令牌；必须先取得用户确认`);
  }
  return { argv: [...argv.slice(0, index), ...argv.slice(index + 2)], confirmation: argv[index + 1] };
}

export async function requireSkillCompatibility(confirmation?: string) {
  const report = await checkSkillCompatibility();
  if (report.compatible) {
    if (confirmation) throw new Error('版本已匹配，不接受过期的版本确认令牌');
    return report;
  }
  if (confirmation !== report.confirmationToken) {
    throw new Error(`CLI / Skill 版本不匹配，业务尚未启动。${JSON.stringify(report)}。请展示差异并等待用户明确确认；确认后本轮命令可携带 --confirm-version-mismatch <confirmationToken>。不得自动确认。`);
  }
  console.error(`警告：按用户确认继续使用不匹配版本，Skill=${report.skillDir}，版本=${JSON.stringify(report.actual)}`);
  return report;
}
