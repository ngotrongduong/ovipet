"use strict";

let audioContext = null;

async function playSpeciesAlert() {
  audioContext ||= new AudioContext();
  if (audioContext.state === "suspended") await audioContext.resume();
  const start = audioContext.currentTime + 0.02;
  const notes = [880, 660, 880];
  notes.forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const noteStart = start + index * 0.22;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, noteStart);
    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(0.18, noteStart + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.16);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteStart + 0.18);
  });
}

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === "playSpeciesAlert") playSpeciesAlert().catch(() => {});
});
