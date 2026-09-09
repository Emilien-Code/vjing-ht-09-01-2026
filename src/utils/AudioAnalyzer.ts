const FFTSIZE = 2048;

export default class AudioAnalyzer {
  private audioCtx: AudioContext;
  private analyser: AnalyserNode;
  private noiseAmplitude: number = -1;
  private noiseFactor: number = -1;

  private bufferLength: number;
  private dataArray: Uint8Array;
  private audio: HTMLAudioElement;
  private isPlaying = false;
  constructor() {
    this.audio = document.createElement("audio");
    this.audio.src = "/03-Digeridoo (2022 Remaster).mp3";
    this.audio.volume = 0.2;
    this.audioCtx = new AudioContext();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = FFTSIZE;
    const source = this.audioCtx.createMediaElementSource(this.audio);
    source.connect(this.analyser);

    this.analyser.connect(this.audioCtx.destination);

    this.bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(this.bufferLength);
  }
  play() {
    if (this.audioCtx.state === "suspended") {
      this.audioCtx.resume();
    }
    this.audio.play();
    this.isPlaying = true;
  }
  pause() {
    this.isPlaying = false;
    this.audio.pause();
  }
  get isMusicPlaying() {
    return this.isPlaying;
  }

}
