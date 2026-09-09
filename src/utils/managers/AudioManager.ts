import * as THREE from 'three'

export default class AudioManager {

  public frequencyArray: Uint8Array<ArrayBufferLike>
  public frequencyData: {
    low: number
    mid: number
    high: number
  }
  // Full normalized (0..1) spectrum, one entry per analyser bin — the
  // per-frequency-bin signal used by shaders/particles that sample bands.
  public spectrum: Float32Array
  public volume: number
  public volumeSmooth: number
  public isPlaying: boolean
  public lowFrequency: number
  public midFrequency: number
  public highFrequency: number
  public audioContext: AudioContext | null
  public audio: THREE.Audio | null = null
  public audioAnalyser: THREE.AudioAnalyser | null = null
  public bufferLength: number | null = null

  constructor() {
    this.frequencyArray = new Uint8Array() as Uint8Array<ArrayBufferLike>
    this.frequencyData = {
      low: 0,
      mid: 0,
      high: 0,
    }
    this.spectrum = new Float32Array(0)
    this.volume = 0
    this.volumeSmooth = 0
    this.isPlaying = false
    this.lowFrequency = 10 //10Hz to 250Hz
    this.midFrequency = 150 //150Hz to 2000Hz
    this.highFrequency = 9000 //2000Hz to 20000Hz
    this.audioContext = null
  }

  // Live mic input — this project has no track playback anymore, the mic is
  // the only source and it drives the continuous audio-reactive signals
  // (frequencyData / spectrum / volumeSmooth). Beat timing itself comes from
  // BPMManager, not from anything analysed here.
  async connectMic() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })

    const audioListener = new THREE.AudioListener()
    this.audio = new THREE.Audio(audioListener)
    this.audio.setMediaStreamSource(stream)

    this.audioAnalyser = new THREE.AudioAnalyser(this.audio, 1024)
    this.audioContext = this.audio.context
    this.bufferLength = this.audioAnalyser.data.length
    this.spectrum = new Float32Array(this.bufferLength)
    this.isPlaying = true

    // Browsers start a fresh AudioContext suspended until a user gesture.
    if (this.audioContext.state !== 'running') {
      const resume = () => {
        this.audioContext?.resume()
        window.removeEventListener('pointerdown', resume)
        window.removeEventListener('keydown', resume)
      }
      window.addEventListener('pointerdown', resume)
      window.addEventListener('keydown', resume)
    }
  }

  collectAudioData() {
    if (!this.audioAnalyser) return

    this.frequencyArray = this.audioAnalyser.getFrequencyData()
  }

  analyzeFrequency() {
    if (!this.bufferLength) return
    if (!this.audioContext) return
    if (!this.frequencyArray) return
    // Calculate the average frequency value for each range of frequencies
    const lowFreqRangeStart = Math.floor((this.lowFrequency * this.bufferLength) / this.audioContext.sampleRate)
    const lowFreqRangeEnd = Math.floor((this.midFrequency * this.bufferLength) / this.audioContext.sampleRate)
    const midFreqRangeStart = Math.floor((this.midFrequency * this.bufferLength) / this.audioContext.sampleRate)
    const midFreqRangeEnd = Math.floor((this.highFrequency * this.bufferLength) / this.audioContext.sampleRate)
    const highFreqRangeStart = Math.floor((this.highFrequency * this.bufferLength) / this.audioContext.sampleRate)
    const highFreqRangeEnd = this.bufferLength - 1

    const lowAvg = this.normalizeValue(this.calculateAverage(this.frequencyArray, lowFreqRangeStart, lowFreqRangeEnd))
    const midAvg = this.normalizeValue(this.calculateAverage(this.frequencyArray, midFreqRangeStart, midFreqRangeEnd))
    const highAvg = this.normalizeValue(this.calculateAverage(this.frequencyArray, highFreqRangeStart, highFreqRangeEnd))

    this.frequencyData = {
      low: lowAvg,
      mid: midAvg,
      high: highAvg,
    }

    for (let i = 0; i < this.bufferLength; i++) {
      this.spectrum[i] = this.frequencyArray[i] / 255
    }

    this.volume = (lowAvg + midAvg + highAvg) / 3
    // attack fast, release slow — same shape the old analyzer used for its volumeSmooth
    const rate = this.volume > this.volumeSmooth ? 0.5 : 0.08
    this.volumeSmooth += (this.volume - this.volumeSmooth) * rate
  }

  calculateAverage(array: Uint8Array<ArrayBufferLike>, start: number, end: number) {
    let sum = 0
    for (let i = start; i <= end; i++) {
      sum += array[i]
    }
    return sum / (end - start + 1)
  }

  normalizeValue(value: number) {
    // Assuming the frequency values are in the range 0-256 (for 8-bit data)
    return value / 256
  }

  update() {
    if (!this.isPlaying) return

    this.collectAudioData()
    this.analyzeFrequency()
  }
}
