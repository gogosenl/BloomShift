const fs = require("fs");
const path = require("path");

const SAMPLE_RATE = 22050;
const outputDirectory = path.join(__dirname, "..", "assets", "audio");

function clamp(value) {
  return Math.max(-1, Math.min(1, value));
}

function envelope(time, duration, attack = 0.02, release = 0.12) {
  const fadeIn = Math.min(1, time / attack);
  const fadeOut = Math.min(1, (duration - time) / release);
  return Math.max(0, Math.min(fadeIn, fadeOut));
}

function writeWave(filename, duration, sampleAt) {
  const sampleCount = Math.floor(duration * SAMPLE_RATE);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / SAMPLE_RATE;
    buffer.writeInt16LE(Math.round(clamp(sampleAt(time)) * 32767), 44 + index * 2);
  }

  fs.writeFileSync(path.join(outputDirectory, filename), buffer);
}

function sine(frequency, time, phase = 0) {
  return Math.sin(Math.PI * 2 * frequency * time + phase);
}

fs.mkdirSync(outputDirectory, { recursive: true });

writeWave("garden-loop.wav", 16, (time) => {
  const chords = [
    [261.63, 329.63, 392.0],
    [220.0, 261.63, 329.63],
    [174.61, 220.0, 293.66],
    [196.0, 246.94, 329.63],
  ];
  const chord = chords[Math.floor(time / 4) % chords.length];
  const sectionTime = time % 4;
  const padEnvelope =
    Math.sin((Math.PI / 2) * Math.min(1, sectionTime / 0.8)) *
    Math.sin((Math.PI / 2) * Math.min(1, (4 - sectionTime) / 0.8));
  const loopEnvelope = envelope(time, 16, 0.7, 0.7);
  const pad = chord.reduce(
    (sum, frequency, index) =>
      sum +
      sine(frequency / 2, time, index * 0.7) * 0.16 +
      sine(frequency, time, index * 0.35) * 0.045,
    0
  );
  const noteIndex = Math.floor(time * 2) % chord.length;
  const noteTime = (time * 2) % 1;
  const pluck =
    sine(chord[noteIndex] * 2, time) *
    Math.exp(-noteTime * 5.5) *
    0.055;
  return (pad * padEnvelope + pluck) * loopEnvelope;
});

writeWave("tap.wav", 0.11, (time) => {
  const frequency = 620 + time * 1200;
  return sine(frequency, time) * envelope(time, 0.11, 0.005, 0.08) * 0.28;
});

writeWave("ripple.wav", 0.42, (time) => {
  const glide = 300 + time * 520;
  const first = sine(glide, time) * 0.22;
  const second = sine(glide * 1.5, time, 0.8) * 0.1;
  return (first + second) * envelope(time, 0.42, 0.012, 0.3);
});

writeWave("success.wav", 1.15, (time) => {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  return notes.reduce((sum, frequency, index) => {
    const start = index * 0.18;
    const localTime = time - start;
    if (localTime < 0 || localTime > 0.62) return sum;
    return (
      sum +
      sine(frequency, localTime) *
        envelope(localTime, 0.62, 0.01, 0.45) *
        0.15
    );
  }, 0);
});

writeWave("unlock.wav", 1.55, (time) => {
  const notes = [261.63, 329.63, 392.0, 523.25, 659.25];
  return notes.reduce((sum, frequency, index) => {
    const start = index * 0.16;
    const localTime = time - start;
    if (localTime < 0 || localTime > 0.82) return sum;
    return (
      sum +
      (sine(frequency, localTime) + sine(frequency * 2, localTime) * 0.2) *
        envelope(localTime, 0.82, 0.015, 0.56) *
        0.105
    );
  }, 0);
});

console.log(`Generated audio assets in ${outputDirectory}`);
