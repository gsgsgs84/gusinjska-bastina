# Soundtrack for the showcase film: 110 bpm, 12 bars, chords per 2-bar scene.
import numpy as np, wave
SR = 48000; BPM = 110; BEAT = 60 / BPM; BAR = 4 * BEAT; DUR = 12 * BAR
N = int(DUR * SR) + 1
t_all = np.arange(N) / SR
rng = np.random.default_rng(7)
def midi(n): return 440 * 2 ** ((n - 69) / 12)
# chord per bar (midi notes of the pad voicing)
B, D, Fs, G, A, Cs, E = 47, 50, 54, 55, 57, 61, 52
CH = {'Bm': [47, 54, 59, 62, 66], 'G': [43, 50, 55, 59, 62], 'D': [50, 57, 62, 66, 69], 'A': [45, 52, 57, 61, 64]}
BARS = ['Bm', 'Bm', 'G', 'G', 'D', 'D', 'A', 'A', 'Bm', 'Bm', 'G', 'D']
ROOT = {'Bm': 35, 'G': 31, 'D': 38, 'A': 33}
L = np.zeros(N); R = np.zeros(N)
def add(sig, start, pan=0.0, gain=1.0):
    i = int(round(start * SR))
    if i < 0: sig = sig[-i:]; i = 0
    j = min(N, i + len(sig))
    if j <= i: return
    s = sig[:j - i] * gain
    L[i:j] += s * np.sqrt(0.5 * (1 - pan)); R[i:j] += s * np.sqrt(0.5 * (1 + pan))

# --- pad: soft additive saw (8 harmonics, 1/n^1.4), detuned pair, slow swell per chord ---
def pad_note(f, dur):
    n = int(dur * SR); tt = np.arange(n) / SR; s = np.zeros(n)
    for det in (-0.12, 0.12):
        ff = f * 2 ** (det / 12 / 4)
        for h in range(1, 9): s += np.sin(2 * np.pi * ff * h * tt + h * 0.7 + det) / h ** 1.4
    env = np.minimum(1, tt / 0.9) * np.minimum(1, (dur - tt) / 0.7)
    trem = 1 + 0.06 * np.sin(2 * np.pi * 0.23 * tt)
    return s * env * trem
i = 0
while i < 12:
    c = BARS[i]; j = i
    while j < 12 and BARS[j] == c: j += 1
    dur = (j - i) * BAR + 0.7
    for k, n in enumerate(CH[c]): add(pad_note(midi(n), dur), i * BAR - 0.05, pan=(k - 2) * 0.25, gain=0.010 if i < 2 else 0.0085)
    i = j

# --- Karplus-Strong plucks (arpeggio in 8ths), from bar 2; sparse bells in the intro ---
def pluck(f, dur=1.6, bright=0.5):
    n = int(dur * SR); p = max(2, int(SR / f)); buf = rng.uniform(-1, 1, p) * 0.9
    buf = np.convolve(buf, [bright, 1 - bright], 'same')
    out = np.zeros(n); decay = 0.996
    for k in range(n):
        v = buf[k % p]; out[k] = v
        buf[k % p] = decay * 0.5 * (v + buf[(k + 1) % p])
    env = np.exp(-np.arange(n) / SR * 1.8)
    return out * env
cache = {}
def pl(n, dur=1.4):
    key = (n, dur)
    if key not in cache: cache[key] = pluck(midi(n), dur)
    return cache[key]
ARP = {'Bm': [59, 66, 71, 74, 71, 66, 62, 66], 'G': [55, 62, 67, 71, 67, 62, 59, 62], 'D': [62, 69, 74, 78, 74, 69, 66, 69], 'A': [57, 64, 69, 73, 69, 64, 61, 64]}
for b in range(2, 12):
    c = BARS[b]
    for k in range(8):
        if b == 11 and k > 0: break                       # final chord: one pluck, let it ring
        t0 = b * BAR + k * BEAT / 2 + (0.012 if k % 2 else 0)   # a little swing
        vel = 0.9 if k % 4 == 0 else 0.62
        add(pl(ARP[c][k], 2.4 if b == 11 else 1.2), t0, pan=0.32 * (1 if k % 2 else -1), gain=0.26 * vel)
# intro bells (bars 0-1): high pentatonic notes on beats 1 and 3
def bell(f, dur=2.5):
    n = int(dur * SR); tt = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(2 * np.pi * f * 2.76 * tt) * np.exp(-tt * 3) + 0.2 * np.sin(2 * np.pi * f * 5.4 * tt) * np.exp(-tt * 6)
    return s * np.exp(-tt * 1.6) * np.minimum(1, tt / 0.004)
for k, (b, n) in enumerate([(0, 78), (0.5, 74), (1, 71), (1.5, 73)]):
    add(bell(midi(n)), b * BAR + 0.15, pan=0.3 * (-1) ** k, gain=0.10)

# --- bass + soft kick in the middle scenes (bars 4-9), half-time in the outro ---
def bass(f, dur):
    n = int(dur * SR); tt = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(2 * np.pi * 2 * f * tt)
    return s * np.minimum(1, tt / 0.02) * np.exp(-tt * 1.1)
def kick():
    n = int(0.35 * SR); tt = np.arange(n) / SR
    f = 46 + 70 * np.exp(-tt * 28); ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-tt * 9) * np.minimum(1, tt / 0.002)
K = kick()
for b in range(2, 12):
    add(bass(midi(ROOT[BARS[b]]), BAR), b * BAR, gain=0.11 if b >= 4 else 0.07)
    if 4 <= b <= 9:
        for q in (0, 2): add(K, b * BAR + q * BEAT, gain=0.20)
    elif b == 10: add(K, b * BAR, gain=0.16)
# --- shaker-like hats (filtered noise) on off-beats, bars 4-9 ---
def hat():
    n = int(0.06 * SR); s = rng.normal(0, 1, n); s = s - np.convolve(s, np.ones(6) / 6, 'same')
    return s * np.exp(-np.arange(n) / SR * 70)
for b in range(4, 10):
    for k in range(4): add(hat(), b * BAR + (k + 0.5) * BEAT, pan=0.4, gain=0.018)

# --- swells into each cut (rising filtered noise) ---
def swell(dur=0.9):
    n = int(dur * SR); tt = np.arange(n) / SR; s = rng.normal(0, 1, n)
    out = np.zeros(n); a = 0.0
    c = 0.02 + 0.25 * (tt / dur) ** 2
    for k in range(n):                                     # one-pole low-pass opening up
        a += c[k] * (s[k] - a); out[k] = a
    return out * (tt / dur) ** 2 * np.minimum(1, (dur - tt) / 0.05)
SWL = swell()
for sc in range(1, 6): add(SWL, sc * 2 * BAR - 0.9, gain=0.10)

# --- reverb (Schroeder: 4 combs + 2 allpass, via lfilter), mixed in lightly ---
from scipy.signal import lfilter
def comb(x, d, g): a = np.zeros(d + 1); a[0] = 1; a[d] = -g; return lfilter([1], a, x)
def allpass(x, d, g): b = np.zeros(d + 1); b[0] = -g; b[d] = 1; a = np.zeros(d + 1); a[0] = 1; a[d] = -g; return lfilter(b, a, x)
def reverb(x, off=0):
    ds = [int(SR * s) + off for s in (0.0297, 0.0371, 0.0411, 0.0437)]
    y = sum(comb(x, d, 0.84) for d in ds) / 4
    y = allpass(allpass(y, int(SR * 0.005), 0.7), int(SR * 0.0017), 0.7)
    return lfilter([0.35], [1, -0.65], y)                  # darken the tail
wetL, wetR = reverb(L), reverb(R, 23)
L = L + 0.30 * wetL; R = R + 0.30 * wetR

# --- master: high-pass (no rumble / DC), fades, gentle saturation, normalise ---
from scipy.signal import butter, sosfilt
hp = butter(2, 38, 'highpass', fs=SR, output='sos'); L = sosfilt(hp, L); R = sosfilt(hp, R)
fade = np.minimum(1, t_all / 0.25) * np.minimum(1, (DUR - t_all) / 1.6).clip(0, 1)
L *= fade; R *= fade
m = max(np.abs(L).max(), np.abs(R).max()); L /= m; R /= m
L = np.tanh(L * 1.3) / np.tanh(1.3); R = np.tanh(R * 1.3) / np.tanh(1.3)
L *= 0.89; R *= 0.89                                      # ~ -1 dBFS peak
rms = np.sqrt(np.mean((L ** 2 + R ** 2) / 2)); print('duration %.2f s, rms %.1f dBFS' % (DUR, 20 * np.log10(rms)))
pcm = (np.stack([L, R], 1) * 32767).astype(np.int16)
with wave.open('/home/claude/video/music.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
