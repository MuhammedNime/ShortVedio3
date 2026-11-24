import {
  BUILTIN_3D_CHARACTERS,
  DEFAULT_STORY_CINEMA_SETTINGS,
  resolveStoryLocationInfo,
} from '../data/storyAssets';
import {
  QuizProject,
  StoryAtmosphere,
  StoryCharacterProfile,
  StoryCinemaSettings,
  StoryDialogueLine,
  StoryScene,
  StorySceneSchedule,
  computeStoryTimeline,
  getCanvasDimensions,
  getIntroHookDuration,
  getStoryContentDuration,
  getStoryTotalDuration,
} from '../types/quiz';

export interface StoryTimeInfo {
  sceneIndex: number;
  scene: StoryScene;
  lineIndex: number;
  line: StoryDialogueLine | null;
  localSceneTime: number;
  localLineTime: number;
  lineProgress: number;
  schedule: StorySceneSchedule;
}

export interface StoryTimelineSoundEvent {
  type: 'introHook' | 'sceneEnter' | 'dialogueLine';
  sceneIndex: number;
  lineIndex?: number;
  maxDuration?: number;
}

const storyImageCache = new Map<string, HTMLImageElement>();
const storyImageLoading = new Map<string, Promise<HTMLImageElement | null>>();

function loadStoryImage(src?: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  const existing = storyImageCache.get(src);
  if (existing && existing.complete && existing.naturalWidth > 0) {
    return Promise.resolve(existing);
  }
  const inflight = storyImageLoading.get(src);
  if (inflight) return inflight;

  const p = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      storyImageCache.set(src, img);
      storyImageLoading.delete(src);
      resolve(img);
    };
    img.onerror = () => {
      storyImageLoading.delete(src);
      resolve(null);
    };
    img.src = src;
  });
  storyImageLoading.set(src, p);
  return p;
}

function getCachedStoryImage(src?: string): HTMLImageElement | null {
  if (!src) return null;
  const img = storyImageCache.get(src);
  if (img && img.complete && img.naturalWidth > 0) {
    return img;
  }
  return null;
}

export async function preloadStoryAssets(project: QuizProject): Promise<void> {
  const urls = new Set<string>();
  const chars = project.storyCharacters?.length ? project.storyCharacters : BUILTIN_3D_CHARACTERS;
  for (const ch of chars) {
    if (ch.avatarUrl) urls.add(ch.avatarUrl);
  }
  for (const sc of project.storyScenes ?? []) {
    const loc = resolveStoryLocationInfo(sc.locationId, sc.customLocationUrl);
    if (loc.src) urls.add(loc.src);
  }
  if (project.template?.brandLogoDataUrl) {
    urls.add(project.template.brandLogoDataUrl);
  }
  await Promise.all(Array.from(urls).map((u) => loadStoryImage(u)));
}

export function getStoryTimeInfo(
  globalTime: number,
  project: QuizProject
): StoryTimeInfo | null {
  const scenes = project.storyScenes ?? [];
  if (scenes.length === 0) return null;
  const schedules = computeStoryTimeline(
    scenes,
    project.timing,
    project.storySettings,
    project.template
  );
  if (schedules.length === 0) return null;

  let chosen = schedules[schedules.length - 1];
  for (let i = 0; i < schedules.length; i++) {
    const s = schedules[i];
    const nextStart = i < schedules.length - 1 ? schedules[i + 1].startTime : Infinity;
    if (globalTime < nextStart) {
      chosen = s;
      break;
    }
  }

  const scene = scenes[chosen.sceneIndex];
  const localSceneTime = Math.max(0, Math.min(chosen.duration, globalTime - chosen.startTime));

  let activeLineIdx = 0;
  let activeLine: StoryDialogueLine | null = scene.lines[0] ?? null;
  let localLineTime = 0;
  let lineProgress = 0;

  if (chosen.lines.length > 0) {
    let picked = chosen.lines[chosen.lines.length - 1];
    for (let i = 0; i < chosen.lines.length; i++) {
      const l = chosen.lines[i];
      const nextStart = i < chosen.lines.length - 1 ? chosen.lines[i + 1].startTime : Infinity;
      if (globalTime < nextStart) {
        picked = l;
        break;
      }
    }
    activeLineIdx = picked.lineIndex;
    activeLine = scene.lines[activeLineIdx] ?? null;
    localLineTime = Math.max(0, globalTime - picked.startTime);
    lineProgress = Math.max(0, Math.min(1, localLineTime / Math.max(0.2, picked.duration)));
  }

  return {
    sceneIndex: chosen.sceneIndex,
    scene,
    lineIndex: activeLineIdx,
    line: activeLine,
    localSceneTime,
    localLineTime,
    lineProgress,
    schedule: chosen,
  };
}

export function collectStorySoundEventsInInterval(
  prevTime: number,
  currTime: number,
  project: QuizProject
): StoryTimelineSoundEvent[] {
  const events: StoryTimelineSoundEvent[] = [];
  const scenes = project.storyScenes ?? [];
  if (currTime <= prevTime || scenes.length === 0) return events;

  const schedules = computeStoryTimeline(
    scenes,
    project.timing,
    project.storySettings,
    project.template
  );
  const introDur = getIntroHookDuration(project.template, project.timing);
  if (introDur > 0 && prevTime < 0 && currTime >= 0) {
    const firstStart = schedules[0]?.startTime ?? introDur;
    events.push({
      type: 'introHook',
      sceneIndex: 0,
      maxDuration: Math.max(0.15, firstStart - 0.02),
    });
  }

  for (let sIdx = 0; sIdx < schedules.length; sIdx++) {
    const sched = schedules[sIdx];
    const nextSceneStart =
      sIdx < schedules.length - 1 ? schedules[sIdx + 1].startTime : sched.endTime;

    if (prevTime < sched.startTime && currTime >= sched.startTime) {
      events.push({
        type: 'sceneEnter',
        sceneIndex: sIdx,
        maxDuration: Math.min(0.6, Math.max(0.15, sched.titleHold || 0.35)),
      });
    }

    for (let lIdx = 0; lIdx < sched.lines.length; lIdx++) {
      const ls = sched.lines[lIdx];
      const nextLineStart =
        lIdx < sched.lines.length - 1 ? sched.lines[lIdx + 1].startTime : nextSceneStart;
      if (prevTime < ls.startTime && currTime >= ls.startTime) {
        events.push({
          type: 'dialogueLine',
          sceneIndex: sIdx,
          lineIndex: lIdx,
          maxDuration: Math.max(0.2, nextLineStart - ls.startTime - 0.02),
        });
      }
    }
  }

  return events;
}

function easeOutCubic(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return 1 - Math.pow(1 - t, 3);
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function drawArchPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const archR = w * 0.5;
  const springY = y + Math.min(archR * 0.88, h * 0.42);
  const bottomR = Math.min(28, w * 0.12);
  ctx.beginPath();
  ctx.moveTo(x, springY);
  ctx.quadraticCurveTo(x, y + h * 0.05, x + w * 0.5, y);
  ctx.quadraticCurveTo(x + w, y + h * 0.05, x + w, springY);
  ctx.lineTo(x + w, y + h - bottomR);
  ctx.quadraticCurveTo(x + w, y + h, x + w - bottomR, y + h);
  ctx.lineTo(x + bottomR, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bottomR);
  ctx.closePath();
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  panNormX = 0,
  panNormY = 0,
  zoom = 1
): void {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;

  const scaleBase = Math.max(dw / iw, dh / ih) * zoom;
  const rw = iw * scaleBase;
  const rh = ih * scaleBase;
  const slackX = Math.max(0, rw - dw);
  const slackY = Math.max(0, rh - dh);

  const ox = dx - slackX * (0.5 + panNormX * 0.45);
  const oy = dy - slackY * (0.5 + panNormY * 0.45);
  ctx.drawImage(img, ox, oy, rw, rh);
}

function drawAtmosphereVfx(
  ctx: CanvasRenderingContext2D,
  atmo: StoryAtmosphere,
  globalTime: number,
  width: number,
  height: number
): void {
  if (atmo === 'none') return;

  ctx.save();
  if (atmo === 'goldenDust' || atmo === 'lanternGlow') {
    const count = atmo === 'lanternGlow' ? 28 : 24;
    for (let i = 0; i < count; i++) {
      const seedA = Math.sin(i * 19.37 + 3.1) * 0.5 + 0.5;
      const seedB = Math.cos(i * 41.13 + 7.4) * 0.5 + 0.5;
      const speedY = atmo === 'lanternGlow' ? 0.035 + seedA * 0.03 : 0.018 + seedA * 0.02;
      const px =
        ((seedB + Math.sin(globalTime * 0.45 + i) * 0.03) % 1) * width;
      const py =
        (1 - ((seedA + globalTime * speedY) % 1)) * height;
      const rad = (atmo === 'lanternGlow' ? 4 : 2.5) + (i % 4) * 1.4;
      const alpha =
        (0.2 + 0.35 * (0.5 + 0.5 * Math.sin(globalTime * 2.1 + i * 1.7))) *
        (atmo === 'lanternGlow' ? 0.9 : 0.75);

      const g = ctx.createRadialGradient(px, py, 0, px, py, rad * 3.2);
      g.addColorStop(0, `rgba(255, 224, 140, ${alpha.toFixed(3)})`);
      g.addColorStop(0.45, `rgba(245, 179, 53, ${(alpha * 0.42).toFixed(3)})`);
      g.addColorStop(1, 'rgba(245, 179, 53, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, rad * 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (atmo === 'starlight') {
    for (let i = 0; i < 36; i++) {
      const sx = (Math.sin(i * 73.1) * 0.5 + 0.5) * width;
      const sy = (Math.cos(i * 29.7) * 0.5 + 0.5) * height * 0.55;
      const twinkle = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(globalTime * 2.4 + i * 2.3));
      const r = 1.4 + (i % 3) * 1.1;
      ctx.fillStyle = `rgba(224, 242, 254, ${(twinkle * 0.75).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (atmo === 'rain') {
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.28)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 42; i++) {
      const seed = (Math.sin(i * 91.7) * 0.5 + 0.5);
      const x = ((seed * width + globalTime * 110) % (width + 80)) - 40;
      const y = (((i * 67 + globalTime * 950) % (height + 120)) - 60);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 14, y + 46);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function wrapArabicLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  for (const para of paragraphs) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const cand = `${current} ${words[i]}`;
      if (ctx.measureText(cand).width <= maxWidth) {
        current = cand;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }
  return lines;
}

function drawSafeGuidesOverlay(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.55)';
  ctx.setLineDash([12, 10]);
  ctx.lineWidth = 3;
  const topSafe = Math.round(height * 0.08);
  const bottomSafe = Math.round(height * (height > width ? 0.2 : 0.14));
  const rightSafe = Math.round(width * 0.12);
  ctx.strokeRect(24, topSafe, width - rightSafe - 24, height - topSafe - bottomSafe);
  ctx.restore();
}

function drawBrandWatermark(
  ctx: CanvasRenderingContext2D,
  project: QuizProject,
  globalTime: number,
  width: number,
  height: number
): void {
  const t = project.template;
  if (!t?.brandLogoDataUrl && !t?.brandHandleText?.trim()) return;
  const img = getCachedStoryImage(t.brandLogoDataUrl);
  const opacity = Math.max(0.2, Math.min(1, t.brandOpacity ?? 0.92));
  const size = Math.max(48, Math.min(180, t.brandLogoSize || 92));
  const pos = t.brandLogoPosition || 'topRight';

  let bx = width - size - 36;
  let by = 48;
  if (pos === 'topLeft') {
    bx = 36;
    by = 48;
  } else if (pos === 'bottomRight') {
    bx = width - size - 36;
    by = height - size - 48;
  } else if (pos === 'bottomLeft') {
    bx = 36;
    by = height - size - 48;
  } else if (pos === 'custom') {
    bx = ((t.brandLogoX ?? 88) / 100) * width - size / 2;
    by = ((t.brandLogoY ?? 10) / 100) * height - size / 2;
  }

  ctx.save();
  ctx.globalAlpha = opacity;
  if (img) {
    const floatY = t.brandLogoAnim === 'float' ? Math.sin(globalTime * 2.5) * 6 : 0;
    const pulse =
      t.brandLogoAnim === 'pulse' ? 1 + Math.sin(globalTime * 3.0) * 0.035 : 1;
    const cx = bx + size / 2;
    const cy = by + size / 2 + floatY;
    ctx.translate(cx, cy);
    ctx.scale(pulse, pulse);
    ctx.beginPath();
    ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
  }
  ctx.restore();

  if (t.brandHandleText?.trim()) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.font = `700 ${height > width ? 26 : 24}px "${t.fontFamily || 'Cairo'}", sans-serif`;
    ctx.textAlign = pos.includes('Left') ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 8;
    const tx = pos.includes('Left') ? 40 + (img ? size + 14 : 0) : width - 40 - (img ? size + 14 : 0);
    const ty = (pos.includes('bottom') ? height - 48 - size / 2 : 48 + size / 2);
    ctx.fillText(t.brandHandleText.trim(), tx, ty);
    ctx.restore();
  }
}

export function renderStoryFrame(
  ctx: CanvasRenderingContext2D,
  globalTime: number,
  project: QuizProject,
  isPreview = true
): void {
  const { width, height } = getCanvasDimensions(project.template);
  const isWide = width > height;
  const fontFamily = project.template?.fontFamily || 'Cairo';
  const scenes = project.storyScenes ?? [];
  const characters =
    project.storyCharacters && project.storyCharacters.length > 0
      ? project.storyCharacters
      : BUILTIN_3D_CHARACTERS;
  const settings: StoryCinemaSettings = {
    ...DEFAULT_STORY_CINEMA_SETTINGS,
    ...(project.storySettings ?? {}),
  };

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#090b10';
  ctx.fillRect(0, 0, width, height);

  if (scenes.length === 0) return;

  const introDur = getIntroHookDuration(project.template, project.timing);
  const contentEnd = getStoryContentDuration(
    scenes,
    project.timing,
    settings,
    project.template
  );
  const totalDur = getStoryTotalDuration(
    scenes,
    project.timing,
    settings,
    project.template
  );

  // =========================================================================
  // 1. INTRO CINEMATIC TITLE HOOK
  // =========================================================================
  if (introDur > 0 && globalTime < introDur) {
    const p = easeOutCubic(Math.min(1, globalTime / Math.max(0.25, introDur * 0.55)));
    const firstLoc = resolveStoryLocationInfo(
      scenes[0].locationId,
      scenes[0].customLocationUrl
    );
    const locImg = getCachedStoryImage(firstLoc.src);
    if (locImg) {
      drawImageCover(ctx, locImg, 0, 0, width, height, 0, 0, 1.04 + globalTime * 0.04);
    }
    ctx.fillStyle = 'rgba(7, 9, 14, 0.62)';
    ctx.fillRect(0, 0, width, height);
    drawAtmosphereVfx(ctx, scenes[0].atmosphere || 'goldenDust', globalTime, width, height);

    const cardW = Math.round(width * (isWide ? 0.68 : 0.86));
    const titleText =
      (project.template.introHookText || project.storyTitle || 'قصة وعبرة').trim();
    ctx.save();
    ctx.globalAlpha = p;
    ctx.translate(width / 2, height * 0.48 + (1 - p) * 28);
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = `700 ${isWide ? 32 : 34}px "${fontFamily}", sans-serif`;
    ctx.fillStyle = '#f5c556';
    ctx.fillText('✦ حكاية قصيرة ثلاثية الأبعاد ✦', 0, -135);

    ctx.font = `800 ${isWide ? 62 : 66}px "${fontFamily}", sans-serif`;
    const wrapped = wrapArabicLines(ctx, titleText, cardW);
    const lh = isWide ? 84 : 90;
    const startY = -((wrapped.length - 1) * lh) / 2 + 10;
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#ffffff';
    wrapped.forEach((ln, idx) => {
      ctx.fillText(ln, 0, startY + idx * lh);
    });
    ctx.restore();

    if (isPreview && project.template.showSafeGuides) {
      drawSafeGuidesOverlay(ctx, width, height);
    }
    return;
  }

  // =========================================================================
  // 2. END MORAL / CTA CARD
  // =========================================================================
  if (project.template.showEndCard && globalTime >= contentEnd) {
    const endT = Math.max(0, globalTime - contentEnd);
    const endTotal = Math.max(1, totalDur - contentEnd);
    const p = easeOutCubic(Math.min(1, endT / 0.45));
    const lastScene = scenes[scenes.length - 1];
    const loc = resolveStoryLocationInfo(
      lastScene.locationId,
      lastScene.customLocationUrl
    );
    const locImg = getCachedStoryImage(loc.src);
    if (locImg) {
      drawImageCover(ctx, locImg, 0, 0, width, height, 0, 0, 1.08);
    }
    ctx.fillStyle = 'rgba(6, 9, 15, 0.78)';
    ctx.fillRect(0, 0, width, height);
    drawAtmosphereVfx(ctx, 'lanternGlow', globalTime, width, height);

    ctx.save();
    ctx.globalAlpha = p;
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const boxW = Math.round(width * (isWide ? 0.68 : 0.86));
    const boxH = isWide ? 420 : 540;
    const bx = (width - boxW) / 2;
    const by = (height - boxH) / 2;

    drawRoundedRectPath(ctx, bx, by, boxW, boxH, 38);
    const cardGrad = ctx.createLinearGradient(bx, by, bx, by + boxH);
    cardGrad.addColorStop(0, 'rgba(20, 24, 34, 0.94)');
    cardGrad.addColorStop(1, 'rgba(11, 14, 21, 0.96)');
    ctx.fillStyle = cardGrad;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(234, 179, 8, 0.75)';
    ctx.stroke();

    ctx.font = `700 ${isWide ? 28 : 30}px "${fontFamily}", sans-serif`;
    ctx.fillStyle = '#f5c556';
    ctx.fillText('✦ العبرة والرسالة ✦', width / 2, by + 76);

    const moralTitle = (settings.endMoralTitle || project.template.endCardText || 'شكراً للمتابعة').trim();
    ctx.font = `800 ${isWide ? 48 : 50}px "${fontFamily}", sans-serif`;
    ctx.fillStyle = '#ffffff';
    const moralLines = wrapArabicLines(ctx, moralTitle, boxW - 88);
    const mlh = isWide ? 66 : 70;
    const mStartY = by + boxH * 0.44 - ((moralLines.length - 1) * mlh) / 2;
    moralLines.slice(0, 3).forEach((ln, idx) => {
      ctx.fillText(ln, width / 2, mStartY + idx * mlh);
    });

    const sub = (settings.endMoralSubtitle || project.template.endCtaText || '').trim();
    if (sub) {
      ctx.font = `600 ${isWide ? 28 : 30}px "${fontFamily}", sans-serif`;
      ctx.fillStyle = '#cbd5e1';
      const subLines = wrapArabicLines(ctx, sub, boxW - 100);
      subLines.slice(0, 2).forEach((ln, idx) => {
        ctx.fillText(ln, width / 2, by + boxH - 135 + idx * 42);
      });
    }

    if (project.template.showEndSubscribeCta) {
      const btnW = 320;
      const btnH = 68;
      const btnX = width / 2 - btnW / 2;
      const btnY = by + boxH - 86 + (1 - Math.min(1, endT / (endTotal * 0.3))) * 8;
      drawRoundedRectPath(ctx, btnX, btnY, btnW, btnH, 20);
      ctx.fillStyle = '#00B050';
      ctx.fill();
      ctx.font = `800 30px "${fontFamily}", sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText('اشترك في القناة 🔔', width / 2, btnY + btnH / 2 + 2);
    }

    ctx.restore();
    drawBrandWatermark(ctx, project, globalTime, width, height);
    return;
  }

  // =========================================================================
  // 3. ACTIVE STORY SCENE + CAMERA + ENVIRONMENT
  // =========================================================================
  const info = getStoryTimeInfo(globalTime, project);
  if (!info) return;
  const { scene, line, localSceneTime, localLineTime, lineProgress, schedule } = info;
  const sceneProg = Math.max(0, Math.min(1, localSceneTime / Math.max(0.5, schedule.duration)));

  const loc = resolveStoryLocationInfo(scene.locationId, scene.customLocationUrl);
  const locImg = getCachedStoryImage(loc.src);

  let zoom = 1.03;
  let panX = 0;
  let panY = 0;
  if (scene.cameraMotion === 'zoomIn') {
    zoom = 1.0 + sceneProg * 0.13;
  } else if (scene.cameraMotion === 'zoomOut') {
    zoom = 1.13 - sceneProg * 0.12;
  } else if (scene.cameraMotion === 'panLeft') {
    zoom = 1.11;
    panX = 0.65 - sceneProg * 1.3;
  } else if (scene.cameraMotion === 'panRight') {
    zoom = 1.11;
    panX = -0.65 + sceneProg * 1.3;
  } else {
    zoom = 1.04 + Math.sin(globalTime * 0.9) * 0.025;
    panY = Math.cos(globalTime * 0.7) * 0.12;
  }

  if (locImg) {
    drawImageCover(ctx, locImg, 0, 0, width, height, panX, panY, zoom);
  } else {
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, '#141926');
    bgGrad.addColorStop(1, '#090b10');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);
  }

  // Cinematic ambient shadow & depth vignette
  const topShade = ctx.createLinearGradient(0, 0, 0, height);
  topShade.addColorStop(0, 'rgba(6, 9, 15, 0.55)');
  topShade.addColorStop(0.24, 'rgba(6, 9, 15, 0.16)');
  topShade.addColorStop(0.62, 'rgba(6, 9, 15, 0.25)');
  topShade.addColorStop(1, 'rgba(5, 7, 12, 0.88)');
  ctx.fillStyle = topShade;
  ctx.fillRect(0, 0, width, height);

  drawAtmosphereVfx(ctx, scene.atmosphere || 'goldenDust', globalTime, width, height);

  // Scene entrance fade
  if (localSceneTime < 0.32 && scene.transition !== 'none') {
    const fadeAlpha = 1 - easeOutCubic(localSceneTime / 0.32);
    ctx.fillStyle = `rgba(5, 7, 12, ${(fadeAlpha * 0.75).toFixed(3)})`;
    ctx.fillRect(0, 0, width, height);
  }

  // =========================================================================
  // 4. SCENE HEADER BANNER (Location / Scene Title)
  // =========================================================================
  if (settings.showSceneHeader) {
    const bannerTitle = (scene.sceneBannerText || `${scene.title} · ${loc.label}`).trim();
    ctx.save();
    ctx.direction = 'rtl';
    ctx.font = `700 ${isWide ? 28 : 30}px "${fontFamily}", sans-serif`;
    const tw = ctx.measureText(bannerTitle).width;
    const pillW = Math.min(width * 0.84, tw + 74);
    const pillH = isWide ? 60 : 66;
    const px = width / 2 - pillW / 2;
    const py = isWide ? 38 : 112;

    drawRoundedRectPath(ctx, px, py, pillW, pillH, 20);
    ctx.fillStyle = 'rgba(11, 14, 21, 0.72)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(234, 179, 8, 0.5)';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fde68a';
    ctx.fillText(bannerTitle, width / 2, py + pillH / 2 + 2);
    ctx.restore();
  }

  // =========================================================================
  // 5. 3D SEMI-REALISTIC CHARACTERS CAST STAGE (1–3 Speakers)
  // =========================================================================
  const activeSpeakerId = line?.speakerId || '';
  const castProfiles: StoryCharacterProfile[] = [];
  for (const cid of scene.characterIds) {
    const found = characters.find((c) => c.id === cid);
    if (found && !castProfiles.some((p) => p.id === found.id)) {
      castProfiles.push(found);
    }
  }
  if (
    activeSpeakerId &&
    activeSpeakerId !== 'narrator' &&
    !castProfiles.some((p) => p.id === activeSpeakerId)
  ) {
    const sp = characters.find((c) => c.id === activeSpeakerId);
    if (sp) castProfiles.unshift(sp);
  }
  const visibleCast = castProfiles.slice(0, 3);

  const stageAreaBottom = isWide ? height * 0.67 : height * 0.63;
  const stageCenterY = isWide ? height * 0.40 : height * 0.42;

  if (visibleCast.length > 0) {
    const count = visibleCast.length;
    const cardW = isWide
      ? count === 1
        ? 390
        : count === 2
          ? 340
          : 295
      : count === 1
        ? 490
        : count === 2
          ? 410
          : 315;
    const cardH = Math.round(cardW * 1.24);
    const gapX = isWide ? 84 : count === 3 ? 28 : 54;
    const totalCastW = count * cardW + (count - 1) * gapX;
    const startX = (width - totalCastW) / 2;

    // Sort draw order so active speaker always renders slightly above neighbors
    const indexedCast = visibleCast.map((char, idx) => ({
      char,
      idx,
      isSpeaking: activeSpeakerId === char.id,
    }));
    indexedCast.sort((a, b) => Number(a.isSpeaking) - Number(b.isSpeaking));

    for (const item of indexedCast) {
      const { char, idx, isSpeaking } = item;
      const cx = startX + idx * (cardW + gapX) + cardW / 2;
      const breathe = Math.sin(globalTime * (isSpeaking ? 3.2 : 1.8) + idx * 1.3) * (isSpeaking ? 7 : 3);
      const speakPop =
        isSpeaking && line
          ? 1.06 +
            Math.sin(localLineTime * 11) * 0.008 +
            (line.expression === 'surprised' && localLineTime < 0.25 ? 0.04 : 0)
          : settings.dimInactiveSpeakers && activeSpeakerId !== 'narrator'
            ? 0.94
            : 1.0;

      const drawW = cardW * speakPop;
      const drawH = cardH * speakPop;
      const dx = cx - drawW / 2;
      const dy = Math.min(stageAreaBottom - drawH, stageCenterY - drawH / 2 + breathe);

      ctx.save();
      if (!isSpeaking && settings.dimInactiveSpeakers && activeSpeakerId !== 'narrator') {
        ctx.globalAlpha = 0.76;
      }

      // Active Speaker Spotlight Aura
      if (isSpeaking) {
        const auraGrad = ctx.createRadialGradient(
          cx,
          dy + drawH * 0.48,
          drawW * 0.15,
          cx,
          dy + drawH * 0.48,
          drawW * 0.85
        );
        auraGrad.addColorStop(0, `${char.accentColor}55`);
        auraGrad.addColorStop(0.55, `${char.accentColor}22`);
        auraGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = auraGrad;
        ctx.beginPath();
        ctx.arc(cx, dy + drawH * 0.48, drawW * 0.85, 0, Math.PI * 2);
        ctx.fill();
      }

      // Drop Shadow
      ctx.shadowColor = isSpeaking ? `${char.accentColor}66` : 'rgba(0,0,0,0.68)';
      ctx.shadowBlur = isSpeaking ? 38 : 22;
      ctx.shadowOffsetY = 14;

      // Clip path according to selected portraitFrameStyle
      const buildClip = () => {
        if (settings.portraitFrameStyle === 'arch') {
          drawArchPath(ctx, dx, dy, drawW, drawH);
        } else if (settings.portraitFrameStyle === 'circle') {
          const r = Math.min(drawW, drawH) * 0.48;
          ctx.beginPath();
          ctx.arc(cx, dy + drawH * 0.5, r, 0, Math.PI * 2);
        } else if (settings.portraitFrameStyle === 'roundedCine') {
          drawRoundedRectPath(ctx, dx, dy, drawW, drawH, 46);
        } else {
          drawRoundedRectPath(ctx, dx, dy, drawW, drawH, 28);
        }
      };

      buildClip();
      ctx.fillStyle = '#0c0f17';
      ctx.fill();

      ctx.save();
      buildClip();
      ctx.clip();

      const avatarImg = getCachedStoryImage(char.avatarUrl);
      if (avatarImg) {
        // Subtle animated scale pulse on image when speaking to convey lifelike energy
        const mouthEnergy = isSpeaking ? 1.03 + Math.abs(Math.sin(localLineTime * 8.5)) * 0.025 : 1.01;
        drawImageCover(ctx, avatarImg, dx, dy, drawW, drawH, 0, -0.06, mouthEnergy);
      }

      // Warm rim / bottom gradient overlay inside frame
      const charInnerShade = ctx.createLinearGradient(dx, dy, dx, dy + drawH);
      charInnerShade.addColorStop(0, isSpeaking ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.12)');
      charInnerShade.addColorStop(0.68, 'rgba(0,0,0,0)');
      charInnerShade.addColorStop(1, 'rgba(7, 10, 16, 0.82)');
      ctx.fillStyle = charInnerShade;
      ctx.fillRect(dx, dy, drawW, drawH);
      ctx.restore();

      // Portrait Frame Rim Border
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      buildClip();
      ctx.lineWidth = isSpeaking ? 6 : 3;
      ctx.strokeStyle = isSpeaking ? char.accentColor : 'rgba(255, 255, 255, 0.25)';
      ctx.stroke();

      // Animated Waveform Bars when this character is speaking
      if (isSpeaking && settings.showWaveform) {
        const waveY = dy + drawH - 36;
        const barCount = 5;
        const barW = 6;
        const barGap = 6;
        const totalWaveW = barCount * barW + (barCount - 1) * barGap;
        const wx0 = cx - totalWaveW / 2;
        ctx.fillStyle = char.accentColor;
        for (let b = 0; b < barCount; b++) {
          const amp = 10 + Math.abs(Math.sin(globalTime * 12 + b * 1.15)) * 20;
          drawRoundedRectPath(ctx, wx0 + b * (barW + barGap), waveY - amp / 2, barW, amp, 3);
          ctx.fill();
        }
      }

      // Nameplate Tag Below Portrait
      if (settings.showCastNames) {
        const plateW = Math.min(drawW * 0.92, 310);
        const plateH = isWide ? 48 : 54;
        const plateX = cx - plateW / 2;
        const plateY = dy + drawH + 14;
        drawRoundedRectPath(ctx, plateX, plateY, plateW, plateH, 16);
        ctx.fillStyle = isSpeaking ? char.accentColor : 'rgba(13, 17, 26, 0.88)';
        ctx.fill();
        if (!isSpeaking) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(255,255,255,0.22)';
          ctx.stroke();
        }
        ctx.direction = 'rtl';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `800 ${isWide ? 24 : 26}px "${fontFamily}", sans-serif`;
        ctx.fillStyle = isSpeaking ? '#090b10' : '#f8fafc';
        ctx.fillText(char.name, cx, plateY + plateH / 2 + 1);
      }

      ctx.restore();
    }
  }

  // =========================================================================
  // 6. ACTIVE DIALOGUE CAPTION / SPEECH BUBBLE BOX
  // =========================================================================
  if (line && line.text.trim()) {
    const activeChar =
      activeSpeakerId === 'narrator'
        ? null
        : characters.find((c) => c.id === activeSpeakerId) ?? null;
    const speakerLabel =
      activeSpeakerId === 'narrator' || !activeChar
        ? '🎙️ الراوي'
        : activeChar.name;
    const speakerRole =
      activeSpeakerId === 'narrator' || !activeChar ? 'السرد القصصي' : activeChar.roleTitle;
    const accent = activeChar?.accentColor || '#f5c556';

    const boxW = Math.round(width * (isWide ? 0.78 : 0.88));
    const bx = (width - boxW) / 2;
    const lineRevealAlpha = easeOutCubic(Math.min(1, localLineTime / 0.24));
    const slideOffset = (1 - lineRevealAlpha) * 18;

    ctx.save();
    ctx.globalAlpha = lineRevealAlpha;
    ctx.translate(0, slideOffset);
    ctx.direction = 'rtl';

    const captionFontSize = isWide ? 40 : 42;
    ctx.font = `700 ${captionFontSize}px "${fontFamily}", sans-serif`;
    const wrappedLines = wrapArabicLines(ctx, line.text.trim(), boxW - 88).slice(0, 4);
    const lineHeight = Math.round(captionFontSize * 1.48);
    const padTop = settings.dialogueStyle === 'subtitleMinimal' ? 28 : 52;
    const padBottom = 34;
    const boxH = Math.max(
      isWide ? 140 : 180,
      padTop + padBottom + wrappedLines.length * lineHeight
    );
    const bottomSafeMargin = isWide ? 62 : 250;
    const by = height - bottomSafeMargin - boxH;

    if (settings.dialogueStyle !== 'subtitleMinimal') {
      ctx.shadowColor = 'rgba(0,0,0,0.75)';
      ctx.shadowBlur = 28;
      ctx.shadowOffsetY = 10;
      drawRoundedRectPath(ctx, bx, by, boxW, boxH, 30);
      const boxGrad = ctx.createLinearGradient(bx, by, bx, by + boxH);
      boxGrad.addColorStop(0, 'rgba(14, 18, 28, 0.93)');
      boxGrad.addColorStop(1, 'rgba(9, 12, 19, 0.96)');
      ctx.fillStyle = boxGrad;
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.lineWidth = 3;
      ctx.strokeStyle = `${accent}AA`;
      ctx.stroke();

      // Speech Bubble Tail pointing toward active speaker
      if (settings.dialogueStyle === 'speechBubble' && activeSpeakerId !== 'narrator') {
        const tailX =
          line.position === 'left'
            ? bx + boxW * 0.24
            : line.position === 'right'
              ? bx + boxW * 0.76
              : width / 2;
        ctx.beginPath();
        ctx.moveTo(tailX - 20, by + 2);
        ctx.lineTo(tailX, by - 22);
        ctx.lineTo(tailX + 20, by + 2);
        ctx.closePath();
        ctx.fillStyle = 'rgba(14, 18, 28, 0.94)';
        ctx.fill();
        ctx.strokeStyle = `${accent}AA`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }

    // Speaker Name Chip overlapping top edge of caption card
    ctx.font = `800 ${isWide ? 26 : 28}px "${fontFamily}", sans-serif`;
    const badgeLabel =
      speakerRole && settings.dialogueStyle !== 'subtitleMinimal'
        ? `${speakerLabel} · ${speakerRole}`
        : speakerLabel;
    const bw = Math.min(boxW - 48, ctx.measureText(badgeLabel).width + 48);
    const bh = 46;
    const badgeX =
      line.position === 'left'
        ? bx + 28
        : line.position === 'center'
          ? width / 2 - bw / 2
          : bx + boxW - bw - 28;
    const badgeY = by - bh / 2;

    drawRoundedRectPath(ctx, badgeX, badgeY, bw, bh, 15);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#090b10';
    ctx.fillText(badgeLabel, badgeX + bw / 2, badgeY + bh / 2 + 1);

    // Dialogue Text with smooth animated reading brightness
    ctx.font = `700 ${captionFontSize}px "${fontFamily}", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textStartY = by + padTop + lineHeight / 2;

    wrappedLines.forEach((txt, idx) => {
      const lineShare = (idx + 1) / Math.max(1, wrappedLines.length);
      const lineActiveBoost = lineProgress >= (idx / Math.max(1, wrappedLines.length)) * 0.85;
      ctx.fillStyle =
        lineActiveBoost || lineShare <= 1
          ? '#ffffff'
          : 'rgba(226, 232, 240, 0.72)';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 10;
      ctx.fillText(txt, width / 2, textStartY + idx * lineHeight);
    });

    // Subtle reading progress bar along bottom edge of caption card
    if (settings.dialogueStyle !== 'subtitleMinimal') {
      const barW = (boxW - 60) * Math.max(0.03, lineProgress);
      drawRoundedRectPath(ctx, bx + 30, by + boxH - 12, barW, 5, 3);
      ctx.fillStyle = accent;
      ctx.fill();
    }

    ctx.restore();
  }

  drawBrandWatermark(ctx, project, globalTime, width, height);
  if (isPreview && project.template.showSafeGuides) {
    drawSafeGuidesOverlay(ctx, width, height);
  }
}

export async function exportStoryThumbnailJpg(
  project: QuizProject,
  timeSec: number
): Promise<Blob | null> {
  await preloadStoryAssets(project);
  const { width, height } = getCanvasDimensions(project.template);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;
  renderStoryFrame(ctx, timeSec, project, false);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92);
  });
}
