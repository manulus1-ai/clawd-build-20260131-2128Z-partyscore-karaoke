import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

type ScoreEntry = {
  name: string;
  score: number;
  ts: number;
  mode: 'local' | 'challenge';
};

type RoundSummary = {
  score: number;
  energy: number;
  stability: number;
  variety: number;
  ts: number;
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnDestroy {
  // UI
  stage: 'onboarding' | 'ready' | 'singing' | 'results' = 'onboarding';
  error: string | null = null;

  playerName = '';

  // Challenge link
  challengeName: string | null = null;
  challengeScore: number | null = null;

  // Live meters
  energy = 0; // 0..1
  pitchHz: number | null = null;
  pitchNote: string | null = null;
  levelBar = 0; // 0..1 (smoothed)

  // Round
  secondsLeft = 10;
  lastRound: RoundSummary | null = null;

  // Leaderboard
  leaderboard: ScoreEntry[] = [];
  personalBest: ScoreEntry | null = null;

  // Audio
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private rafId: number | null = null;
  private roundTimerId: number | null = null;

  private timeData?: Float32Array;

  // Round buffers
  private energySamples: number[] = [];
  private pitchSamples: number[] = [];

  @ViewChild('confettiHost', { static: true }) confettiHost?: ElementRef<HTMLDivElement>;

  constructor() {
    this.loadFromStorage();
    this.readChallengeFromUrl();
  }

  ngOnDestroy(): void {
    this.stopRound();
    this.stopAudio();
  }

  async enableMic(): Promise<void> {
    this.error = null;

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

      const source = this.audioCtx.createMediaStreamSource(this.mediaStream);

      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.6;
      source.connect(this.analyser);

      this.timeData = new Float32Array(this.analyser.fftSize);

      this.stage = 'ready';
      this.loop();
    } catch (e: any) {
      this.error = 'Mic permission denied (or unavailable). This game needs mic access.';
      this.stage = 'onboarding';
    }
  }

  startRound(): void {
    if (!this.analyser || !this.timeData) return;

    this.error = null;
    this.stage = 'singing';
    this.secondsLeft = 10;
    this.lastRound = null;

    this.energySamples = [];
    this.pitchSamples = [];

    if (this.roundTimerId) window.clearInterval(this.roundTimerId);
    this.roundTimerId = window.setInterval(() => {
      this.secondsLeft -= 1;
      if (this.secondsLeft <= 0) {
        this.finishRound();
      }
    }, 1000);
  }

  stopRound(): void {
    if (this.roundTimerId) window.clearInterval(this.roundTimerId);
    this.roundTimerId = null;

    this.stage = this.analyser ? 'ready' : 'onboarding';
  }

  private finishRound(): void {
    if (this.roundTimerId) window.clearInterval(this.roundTimerId);
    this.roundTimerId = null;

    const score = this.computeScore(this.energySamples, this.pitchSamples);

    this.lastRound = {
      ...score,
      ts: Date.now(),
    };

    this.stage = 'results';

    // Update leaderboard
    const name = (this.playerName || 'Player').trim().slice(0, 18);
    const entry: ScoreEntry = {
      name,
      score: score.score,
      ts: Date.now(),
      mode: this.challengeScore != null ? 'challenge' : 'local',
    };

    this.leaderboard.unshift(entry);
    this.leaderboard = this.leaderboard
      .sort((a, b) => b.score - a.score || b.ts - a.ts)
      .slice(0, 25);

    this.personalBest = this.personalBest
      ? (entry.score > this.personalBest.score ? entry : this.personalBest)
      : entry;

    this.saveToStorage();

    if (this.personalBest && entry.ts === this.personalBest.ts) {
      this.fireConfetti();
    }
  }

  shareChallenge(): void {
    if (!this.lastRound) return;

    const url = new URL(window.location.href);
    url.searchParams.set('name', (this.playerName || 'Player').trim().slice(0, 18));
    url.searchParams.set('score', String(this.lastRound.score));

    const text = `PartyScore Karaoke challenge: ${this.lastRound.score}/100. Beat me!`;

    // Try native share first.
    const nav: any = navigator;
    if (nav.share) {
      nav.share({
        title: 'PartyScore Karaoke Challenge',
        text,
        url: url.toString(),
      }).catch(() => {
        // fall back to clipboard
        this.copyToClipboard(url.toString());
      });
      return;
    }

    this.copyToClipboard(url.toString());
  }

  private async copyToClipboard(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.toast('Link copied! Paste it in your group chat.');
    } catch {
      this.toast('Could not auto-copy. Manually copy the URL from the address bar.');
    }
  }

  private toast(message: string): void {
    // Minimal, no deps.
    const host = this.confettiHost?.nativeElement;
    if (!host) return;

    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    host.appendChild(el);
    window.setTimeout(() => el.classList.add('toast--show'));
    window.setTimeout(() => {
      el.classList.remove('toast--show');
      window.setTimeout(() => el.remove(), 250);
    }, 1600);
  }

  private loop(): void {
    if (!this.analyser || !this.timeData) return;

    this.analyser.getFloatTimeDomainData(this.timeData);

    // Energy (RMS)
    let sum = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const v = this.timeData[i];
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.timeData.length);
    this.energy = this.clamp01(rms * 4.0); // boost for typical mic levels
    this.levelBar = this.levelBar * 0.85 + this.energy * 0.15;

    // Pitch via auto-correlation (lightweight)
    const pitch = this.estimatePitchHz(this.timeData, this.audioCtx?.sampleRate ?? 44100);
    this.pitchHz = pitch;
    this.pitchNote = pitch ? this.hzToNote(pitch) : null;

    if (this.stage === 'singing') {
      this.energySamples.push(this.energy);
      if (pitch) this.pitchSamples.push(pitch);
    }

    this.rafId = window.requestAnimationFrame(() => this.loop());
  }

  private estimatePitchHz(buf: Float32Array, sampleRate: number): number | null {
    // Basic auto-correlation-based pitch detection.
    // Tuned for vocals: ~80Hz..800Hz
    const minHz = 80;
    const maxHz = 800;
    const minLag = Math.floor(sampleRate / maxHz);
    const maxLag = Math.floor(sampleRate / minHz);

    // reject silence
    let rms = 0;
    for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);
    if (rms < 0.015) return null;

    // Remove DC offset
    let mean = 0;
    for (let i = 0; i < buf.length; i++) mean += buf[i];
    mean /= buf.length;

    let bestLag = -1;
    let bestCorr = 0;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      for (let i = 0; i < buf.length - lag; i++) {
        const a = buf[i] - mean;
        const b = buf[i + lag] - mean;
        corr += a * b;
      }
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }

    if (bestLag <= 0) return null;

    const hz = sampleRate / bestLag;
    if (!Number.isFinite(hz)) return null;

    return hz;
  }

  private hzToNote(hz: number): string {
    const A4 = 440;
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const n = Math.round(12 * Math.log2(hz / A4));
    const midi = 69 + n;
    const name = noteNames[(midi + 1200) % 12];
    const octave = Math.floor(midi / 12) - 1;
    return `${name}${octave}`;
  }

  private computeScore(energySamples: number[], pitchSamples: number[]): {
    score: number;
    energy: number;
    stability: number;
    variety: number;
  } {
    // Energy: average RMS, but reward peaks a little.
    const avgEnergy = energySamples.length
      ? energySamples.reduce((a, b) => a + b, 0) / energySamples.length
      : 0;
    const peakEnergy = energySamples.length ? Math.max(...energySamples) : 0;
    const energyScore = this.clamp01(avgEnergy * 0.75 + peakEnergy * 0.25);

    // Stability: consistent pitch over time (but don't punish too hard).
    const stabilityScore = this.computePitchStability(pitchSamples);

    // Variety: some pitch movement is fun.
    const varietyScore = this.computePitchVariety(pitchSamples);

    // Fun-first mix
    const raw = energyScore * 0.45 + stabilityScore * 0.35 + varietyScore * 0.20;
    const score = Math.round(this.clamp01(raw) * 100);

    return {
      score,
      energy: Math.round(energyScore * 100),
      stability: Math.round(stabilityScore * 100),
      variety: Math.round(varietyScore * 100),
    };
  }

  private computePitchStability(pitches: number[]): number {
    if (pitches.length < 8) return 0.35; // still give something

    const cleaned = pitches.filter(p => p >= 80 && p <= 800);
    if (cleaned.length < 8) return 0.35;

    const mean = cleaned.reduce((a, b) => a + b, 0) / cleaned.length;
    const variance = cleaned.reduce((acc, p) => acc + (p - mean) ** 2, 0) / cleaned.length;
    const std = Math.sqrt(variance);

    // Convert standard deviation to a 0..1 score.
    // ~0..25Hz is great, 80Hz+ is shaky.
    return this.clamp01(1 - (std - 15) / 85);
  }

  private computePitchVariety(pitches: number[]): number {
    if (pitches.length < 8) return 0.2;

    const cleaned = pitches.filter(p => p >= 80 && p <= 800);
    if (cleaned.length < 8) return 0.2;

    // Count how often we move by at least ~1 semitone.
    const semitone = Math.pow(2, 1 / 12);
    let moves = 0;
    for (let i = 1; i < cleaned.length; i++) {
      const a = cleaned[i - 1];
      const b = cleaned[i];
      const ratio = b > a ? b / a : a / b;
      if (ratio >= semitone) moves++;
    }

    const moveRate = moves / Math.max(1, cleaned.length - 1);

    // Reward a moderate amount of movement.
    // Too flat: 0, too chaotic: also lower.
    const centered = 1 - Math.abs(moveRate - 0.18) / 0.18;
    return this.clamp01(centered);
  }

  private clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
  }

  private stopAudio(): void {
    if (this.rafId) window.cancelAnimationFrame(this.rafId);
    this.rafId = null;

    if (this.mediaStream) {
      for (const t of this.mediaStream.getTracks()) t.stop();
    }
    this.mediaStream = null;

    if (this.audioCtx) {
      this.audioCtx.close().catch(() => void 0);
    }
    this.audioCtx = null;
    this.analyser = null;
  }

  private fireConfetti(): void {
    const host = this.confettiHost?.nativeElement;
    if (!host) return;

    for (let i = 0; i < 42; i++) {
      const piece = document.createElement('span');
      piece.className = 'confetti';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = `hsl(${Math.floor(Math.random() * 360)}, 90%, 60%)`;
      piece.style.animationDelay = `${Math.random() * 0.25}s`;
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      host.appendChild(piece);
      window.setTimeout(() => piece.remove(), 1400);
    }
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem('partyscore_v1');
      if (!raw) return;
      const parsed = JSON.parse(raw);

      this.playerName = typeof parsed.playerName === 'string' ? parsed.playerName : '';
      this.leaderboard = Array.isArray(parsed.leaderboard) ? parsed.leaderboard : [];
      this.personalBest = parsed.personalBest ?? null;
    } catch {
      // ignore
    }
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(
        'partyscore_v1',
        JSON.stringify({
          playerName: this.playerName,
          leaderboard: this.leaderboard,
          personalBest: this.personalBest,
        })
      );
    } catch {
      // ignore
    }
  }

  private readChallengeFromUrl(): void {
    try {
      const url = new URL(window.location.href);
      const name = url.searchParams.get('name');
      const scoreRaw = url.searchParams.get('score');

      const score = scoreRaw ? Number(scoreRaw) : null;
      if (name && score != null && Number.isFinite(score)) {
        this.challengeName = name.slice(0, 18);
        this.challengeScore = Math.max(0, Math.min(100, Math.round(score)));
      }
    } catch {
      // ignore
    }
  }
}
