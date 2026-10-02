// The UI's handle on the synth when the page runs inside the plugin's
// WebView instead of a browser tab. Same surface as Synth (audio.ts), but
// every call goes to the C++ side (plugin/Source/PluginEditor.cpp) over
// JUCE's event bridge, and parameter changes become host parameters.

import type { WorkletStats, WorkletNote } from './worklet/processor.ts';
import type { ParamId, ParamValues } from './dsp/params.ts';

interface JuceBackend {
  emitEvent(id: string, payload: unknown): void;
  addEventListener(id: string, fn: (payload: unknown) => void): unknown;
}

const backend = (): JuceBackend | undefined =>
  (window as unknown as { __JUCE__?: { backend?: JuceBackend } }).__JUCE__?.backend;

/**
 * The width the page is laid out at inside the plugin (the full desktop
 * layout), and the height of its tallest tab (light), which only sets the
 * editor's default size (PluginEditor.h). The page is scaled to the
 * window's width and scrolls when the window is shorter than the tab.
 */
export const UI_W = 1360, UI_H = 1530;

/** Scale the laid-out page to the window's width. */
function fitToWindow(): void {
  const root = document.documentElement.style;
  root.setProperty('--ui-w', `${UI_W}px`);
  root.setProperty('--ui-scale', String(window.innerWidth / UI_W));
}

/** True when the page is the plugin's editor. */
export const inPlugin = (): boolean => backend() !== undefined;

export interface StoredPreset { name: string; values: Partial<ParamValues>; macros?: string[] }

/** Everything the page needs when it opens (or when the host swaps the sound under it). */
export interface PluginState {
  values: ParamValues;
  preset: string;
  last: string;
  user: StoredPreset[];
}

/** A note from the host's MIDI: kind 0 on, 1 off (2, the arp, goes to onNote). */
export type HostNote = [note: number, velocity: number, kind: 0 | 1 | 2];

type FromPlugin =
  | { type: 'state'; values: ParamValues; preset: string; last: string; user: unknown }
  | { type: 'params'; values: Partial<ParamValues> }
  | { type: 'notes'; list: HostNote[] }
  | { type: 'stats'; voices: number; load: number; peakL: number; peakR: number; tempo: number; scope: number[]; display: number[] };

export class PluginSynth {
  public onStats: ((s: WorkletStats & { tempo: number }) => void) | null = null;
  /** Notes the arp played (velocity 0..127, as from the worklet). */
  public onNote: ((n: WorkletNote) => void) | null = null;
  public onState: ((s: PluginState) => void) | null = null;
  /** Parameters the host moved (automation, its own editor). */
  public onParams: ((values: Partial<ParamValues>) => void) | null = null;
  public onHostNotes: ((notes: HostNote[]) => void) | null = null;

  constructor() {
    backend()!.addEventListener('prism', (m) => this.receive(m as FromPlugin));
    fitToWindow();
    window.addEventListener('resize', fitToWindow);
  }

  /** The host owns the audio device: the synth is always on. */
  get running(): boolean { return true; }
  async start(): Promise<void> { /* nothing to wake */ }
  async suspend(): Promise<void> { this.panic(); }
  get latencyMs(): number { return 0; }

  /** Ask for the current state; the answer arrives through onState. */
  ready(): void { this.send({ type: 'ready' }); }

  noteOn(note: number, velocity: number): void { this.send({ type: 'noteOn', note, velocity }); }
  noteOff(note: number): void { this.send({ type: 'noteOff', note }); }
  cc(cc: number, value: number): void { this.send({ type: 'cc', cc, value }); }
  bend(value: number): void { this.send({ type: 'bend', value }); }
  setParam(id: ParamId, value: number): void { this.send({ type: 'param', id, value }); }
  setParams(values: Partial<ParamValues>): void { for (const id in values) this.setParam(id, values[id]!); }
  loadPreset(values: Partial<ParamValues>): void { this.send({ type: 'preset', values, name: '' }); }
  panic(): void { this.send({ type: 'panic' }); }

  /** The preset the header shows ('' once the sound is edited), kept with the session. */
  setCurrent(name: string | null): void { this.send({ type: 'current', name: name ?? '' }); }
  /** Your presets live in a file next to the plugin's other settings, shared by every instance. */
  saveUser(presets: StoredPreset[]): void { this.send({ type: 'saveUser', presets }); }

  private send(payload: Record<string, unknown>): void { backend()?.emitEvent('prism', payload); }

  private receive(m: FromPlugin): void {
    switch (m.type) {
      case 'state': {
        const user = Array.isArray(m.user)
          ? (m.user as StoredPreset[]).filter((p) => typeof p?.name === 'string' && p.values && typeof p.values === 'object')
          : [];
        this.onState?.({ values: m.values, preset: m.preset, last: m.last, user });
        break;
      }
      case 'params': this.onParams?.(m.values); break;
      case 'notes': {
        const host = m.list.filter((n) => n[2] !== 2);
        if (host.length) this.onHostNotes?.(host);
        for (const [note, velocity, kind] of m.list) if (kind === 2) this.onNote?.({ type: 'note', note, velocity });
        break;
      }
      case 'stats':
        this.onStats?.({
          type: 'stats', voices: m.voices, load: m.load, peakL: m.peakL, peakR: m.peakR,
          scope: Float32Array.from(m.scope), display: Float32Array.from(m.display ?? []), tempo: m.tempo,
        });
        break;
    }
  }
}
