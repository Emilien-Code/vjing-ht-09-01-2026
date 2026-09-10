export default class HelpOverlay {

    private el: HTMLDivElement
    private visible: boolean = false

    constructor() {
        this.el = document.createElement('div')
        this.el.innerHTML = this.content()
        this.applyStyles()
        document.body.appendChild(this.el)
    }

    private applyStyles() {
        Object.assign(this.el.style, {
            position: 'fixed',
            inset: '0',
            display: 'none',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.8)',
            color: '#fff',
            fontFamily: 'monospace',
            fontSize: '14px',
            lineHeight: '1.6',
            zIndex: '9999',
            padding: '32px',
            boxSizing: 'border-box',
            overflowY: 'auto',
        } as CSSStyleDeclaration)
    }

    private content() {
        return `
            <div style="max-width: 640px; width: 100%;">
                <h1 style="margin: 0 0 16px; font-size: 20px;">Controls & rules</h1>

                <h2 style="margin: 0 0 8px; font-size: 15px; opacity: 0.8;">Commands</h2>
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
                    <tr><td style="padding: 4px 12px 4px 0; opacity: 0.7;">H</td><td>Toggle this help overlay</td></tr>
                    <tr><td style="padding: 4px 12px 4px 0; opacity: 0.7;">F</td><td>Toggle fullscreen</td></tr>
                    <tr><td style="padding: 4px 12px 4px 0; opacity: 0.7;">Space</td><td>Switch to a new (weighted-random) main scene</td></tr>
                    <tr><td style="padding: 4px 12px 4px 0; opacity: 0.7;">#dev</td><td>Add to the URL to reveal the control panel (BPM, tap tempo, scene visibility, post-processing, export)</td></tr>
                </table>

                <h2 style="margin: 0 0 8px; font-size: 15px; opacity: 0.8;">Scene rules</h2>
                <ul style="margin: 0; padding-left: 18px;">
                    <li>Only one scene is visible at a time: squaresFalling, sphereLevitating, waterDancing, lightStormLevitating, logoLed.</li>
                    <li>Automatic rotation alternates a main scene (squaresFalling, sphereLevitating, or logoLed — logoLed favored) with a lightStormLevitating "beat travel" transition (6-12 beats, camera steps per beat instead of gliding). The same main scene/direction never repeats back to back.</li>
                    <li>waterDancing is manual-only — it's excluded from automatic rotation and Space; reach it from the #dev control panel's Visibility checkboxes.</li>
                    <li>Every beat also has a 50% chance to fire a short glitch effect before reverting to that scene's default look.</li>
                </ul>

                <p style="margin: 24px 0 0; opacity: 0.6;">Press H to close</p>
            </div>
        `
    }

    toggle() {
        this.visible = !this.visible
        this.el.style.display = this.visible ? 'flex' : 'none'
    }
}
