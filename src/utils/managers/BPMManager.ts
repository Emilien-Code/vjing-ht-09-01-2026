import { EventDispatcher } from 'three/webgpu'

type BPMManagerEventMap = {
    beat: {}
}

export default class BPMManager extends EventDispatcher<BPMManagerEventMap> {

    public interval: number; // ms per beat
    public intervalId: number | null;
    public bpmValue: number;
    // Beat pulse: snaps to 1 on every beat, then decays linearly back to 0
    // over the course of that beat — the single signal every visual reads
    // instead of an amplitude-based "kick".
    public pulse: number;

    private tapTimes: number[] = [];

    constructor() {
        super()
        this.interval = 500
        this.intervalId = null
        this.bpmValue = 0
        this.pulse = 0
    }

    setBPM(bpm: number) {
        if (!bpm || bpm <= 0) return
        this.bpmValue = bpm
        this.interval = 60000 / bpm
        this.intervalId !== null && clearInterval(this.intervalId)
        this.intervalId = setInterval(this.updateBPM.bind(this), this.interval)
    }

    updateBPM() {
        this.pulse = 1
        this.dispatchEvent({ type: 'beat' })
    }

    // Tap-tempo: click along with the music, BPM is derived from the
    // average gap between the last few taps. A gap over 2s resets the tally
    // (treated as starting a new tap sequence, not a very slow song).
    tap() {
        const now = performance.now()
        if (this.tapTimes.length && now - this.tapTimes[this.tapTimes.length - 1] > 2000) {
            this.tapTimes = []
        }
        this.tapTimes.push(now)
        if (this.tapTimes.length > 8) this.tapTimes.shift()
        if (this.tapTimes.length < 2) return

        let sum = 0
        for (let i = 1; i < this.tapTimes.length; i++) sum += this.tapTimes[i] - this.tapTimes[i - 1]
        const avgInterval = sum / (this.tapTimes.length - 1)
        this.setBPM(60000 / avgInterval)
    }

    // Called every frame with dt in seconds to decay the beat pulse.
    update(dt: number) {
        if (this.pulse <= 0 || !this.bpmValue) return
        this.pulse = Math.max(0, this.pulse - dt / (this.interval / 1000))
    }

    getBPMDuration() {
        // Returns the duration of one beat
        return this.interval
    }
}
