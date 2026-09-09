import * as THREE from 'three'

export default class AudioManager {


  public frequencyArray: Uint8Array<ArrayBufferLike>
  public frequencyData: {
    low: number
    mid: number
    high: number
  }
  public isPlaying: boolean
  public lowFrequency: number
  public midFrequency: number
  public highFrequency: number
  public smoothedLowFrequency: number
  public audioContext: AudioContext | null
  public song: { url: string }
  public audio: THREE.Audio | null = null
  public audioAnalyser: THREE.AudioAnalyser | null = null
  public bufferLength: number | null = null

  constructor() {
    this.frequencyArray = new Uint8Array as Uint8Array<ArrayBufferLike>
    this.frequencyData = {
      low: 0,
      mid: 0,
      high: 0,
    }
    this.isPlaying = false
    this.lowFrequency = 10 //10Hz to 250Hz
    this.midFrequency = 150 //150Hz to 2000Hz
    this.highFrequency = 9000 //2000Hz to 20000Hz
    this.smoothedLowFrequency = 0
    this.audioContext = null

    this.song = {
      url: '/03-Digeridoo (2022 Remaster).mp3',
    }
  }

  async loadAudioBuffer() {
    // Load the audio file and create the audio buffer
    const promise = new Promise(async (resolve, reject) => {
      const audioListener = new THREE.AudioListener()
      this.audio = new THREE.Audio(audioListener)
      const audioLoader = new THREE.AudioLoader()

      audioLoader.load(this.song.url, (buffer) => {
        if (!this.audio) return
        console.log("audio OK")
        // if (!this.audioContext) return
        console.log("audioContext OK ")
        // if (!this.audioAnalyser) return
        console.log("audioAnalyser OK ")

        this.audio.setBuffer(buffer)
        this.audio.setLoop(true)
        this.audio.setVolume(0.5)
        this.audioContext = this.audio.context
        this.bufferLength = this.audioAnalyser.data.length
        resolve()
      })

      this.audioAnalyser = new THREE.AudioAnalyser(this.audio, 1024)
    })

    return promise
  }

  play() {
    if (!this.audio) return
    this.audio.play()
    this.isPlaying = true
  }

  pause() {
    if (!this.audio) return
    this.audio.pause()
    this.isPlaying = false
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