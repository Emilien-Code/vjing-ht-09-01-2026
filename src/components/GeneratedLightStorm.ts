import Experience from "../Experience"
import * as THREE from "three"
import GUI from "lil-gui"
import World from "../classes/World"
import { Line2 } from "three/examples/jsm/lines/Line2.js"
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js"
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js"

interface Bolt {
    boltGroup: THREE.Group
    life: number
    maxLife: number
    materials: LineMaterial[]
}

export default class LightStorm extends World {

    private exp: Experience
    private scene: THREE.Scene
    private gui: GUI

    private group: THREE.Group
    private bolts: Bolt[] = []
    private guiFolder!: GUI

    private params = {
        boltCount: 20,
        segmentCount: 8,
        circleRadius: 30,
        topSpread: 3,
        zigzagAmount: 0.8,
        spawnRate: 0.3,
        minLife: 5,
        maxLife: 30,
        color: 0xffffff,
        linewidth: 1.5,
        branchCount: 5,
        branchLengthRatio: 0.5,
    }

    constructor(exp: Experience) {
        super()
        this.exp = exp
        this.scene = exp.scene
        this.gui = exp.helpers.GUI

        this.group = new THREE.Group()
        this.scene.add(this.group)

        this.spawnBolt()
        this.setupGUI()
    }

    // Returns both the flat positions array (for LineGeometry) and the points (to pick branch origins)
    private buildMainPoints(): { positions: number[], points: THREE.Vector3[] } {
        const { segmentCount, topSpread, zigzagAmount } = this.params


        const circleRadius = 1.5 + Math.random() * (4 - 1.5)
        // End point: on the circle at Y = 0
        const angle = Math.random() * Math.PI * 2
        const endX = circleRadius * Math.cos(angle)
        const endZ = circleRadius * Math.sin(angle)

        // Start point: always at the origin, above the scene
        const startY = 4 + Math.random() * 6
        const startX = 0
        const startZ = 0

        const points: THREE.Vector3[] = []
        const positions: number[] = []

        for (let i = 0; i <= segmentCount; i++) {
            const t = i / segmentCount
            // Lerp X/Z from start toward the circle landing point
            const x = startX + (endX - startX) * t
            const y = startY * (1 - t)
            const z = startZ + (endZ - startZ) * t
            const jitterX = i > 0 && i < segmentCount ? (Math.random() - 0.5) * zigzagAmount : 0
            const jitterZ = i > 0 && i < segmentCount ? (Math.random() - 0.5) * zigzagAmount : 0
            const p = new THREE.Vector3(x + jitterX, y, z + jitterZ)
            points.push(p)
            positions.push(p.x, p.y, p.z)
        }

        return { positions, points }
    }

    private buildBranchPositions(origin: THREE.Vector3): number[] {
        const { zigzagAmount, branchLengthRatio } = this.params
        const branchSegments = Math.max(2, Math.floor(this.params.segmentCount * branchLengthRatio))

        // Random sideways direction, going down to Y = 0
        const spreadAngle = (Math.random() * Math.PI * 0.5) + Math.PI * 0.25
        const dirX = Math.cos(spreadAngle) * (Math.random() < 0.5 ? 1 : -1)
        const dirZ = Math.sin(spreadAngle) * (Math.random() < 0.5 ? 1 : -1)

        const positions: number[] = []

        for (let i = 0; i <= branchSegments; i++) {
            const t = i / branchSegments
            const y = origin.y * (1 - t)
            const jitterX = i > 0 && i < branchSegments ? (Math.random() - 0.5) * zigzagAmount * 0.6 : 0
            const jitterZ = i > 0 && i < branchSegments ? (Math.random() - 0.5) * zigzagAmount * 0.6 : 0
            positions.push(
                origin.x + dirX * origin.y * t + jitterX,
                y,
                origin.z + dirZ * origin.y * t + jitterZ
            )
        }

        return positions
    }

    private makeLine(positions: number[], linewidth: number, opacity: number): { line: Line2, material: LineMaterial } {
        const material = new LineMaterial({
            color: this.params.color,
            transparent: true,
            opacity,
            linewidth,
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
        })
        const geo = new LineGeometry()
        geo.setPositions(positions)
        const line = new Line2(geo, material)
        line.computeLineDistances()
        return { line, material }
    }

    private spawnBolt() {
        const boltGroup = new THREE.Group()
        const materials: LineMaterial[] = []
        const opacity = 1

        // Main bolt
        const { positions, points } = this.buildMainPoints()
        const { line: mainLine, material: mainMat } = this.makeLine(positions, this.params.linewidth, opacity)
        boltGroup.add(mainLine)
        materials.push(mainMat)

        // Branches from random intermediate points (skip first and last)
        const candidates = points.slice(1, -1)
        const pickedIndices = new Set<number>()
        const branchCount = Math.min(this.params.branchCount, candidates.length)

        while (pickedIndices.size < branchCount) {
            pickedIndices.add(Math.floor(Math.random() * candidates.length))
        }

        for (const idx of pickedIndices) {
            const origin = candidates[idx]
            const branchPositions = this.buildBranchPositions(origin)
            const branchWidth = this.params.linewidth
            const { line: branchLine, material: branchMat } = this.makeLine(branchPositions, branchWidth, opacity * 0.8)
            boltGroup.add(branchLine)
            materials.push(branchMat)
        }

        this.group.add(boltGroup)

        const maxLife = this.params.minLife + Math.floor(Math.random() * (this.params.maxLife - this.params.minLife))
        this.bolts.push({ boltGroup, life: maxLife, maxLife, materials })
    }

    private removeBolt(bolt: Bolt) {
        bolt.boltGroup.traverse(obj => {
            if (obj instanceof Line2) {
                obj.geometry.dispose()
            }
        })
        bolt.materials.forEach(m => m.dispose())
        this.group.remove(bolt.boltGroup)
    }

    private setupGUI() {
        this.guiFolder = this.gui.addFolder('LightStorm')
        const f = this.guiFolder

        f.add(this.params, 'boltCount', 1, 200, 1).name('Max Bolts').onChange(v => {
            this.bolts.forEach(b => this.removeBolt(b))
            this.spawnBolt()
        })
        f.add(this.params, 'segmentCount', 2, 20, 1).name('Segments').onChange(v => {
            this.bolts.forEach(b => this.removeBolt(b))
            this.spawnBolt()
        })
        f.add(this.params, 'circleRadius', 0.5, 30, 0.5).name('Circle Radius').onChange(() => {
            this.bolts.forEach(b => this.removeBolt(b))
            this.bolts = []
            this.spawnBolt()
        })
        f.add(this.params, 'topSpread', 0, 10, 0.1).name('Top Spread').onChange(() => {
            this.bolts.forEach(b => this.removeBolt(b))
            this.bolts = []
            this.spawnBolt()
        })
        f.add(this.params, 'zigzagAmount', 0, 5, 0.05).name('Zigzag Amount').onChange(v => {
            this.bolts.forEach(b => this.removeBolt(b))
            this.spawnBolt()
        })
        f.add(this.params, 'spawnRate', 0, 1, 0.01).name('Spawn Rate').onChange(v => {
            this.bolts.forEach(b => this.removeBolt(b))
            this.spawnBolt()
        })
        f.add(this.params, 'branchCount', 0, 5, 1).name('Branch Count').onChange(v => {
            this.bolts.forEach(b => this.removeBolt(b))
            this.spawnBolt()
        })
        f.add(this.params, 'branchLengthRatio', 0.1, 1, 0.05).name('Branch Length').onChange(v => {
            this.bolts.forEach(b => this.removeBolt(b))
            this.spawnBolt()
        })
        f.add(this.params, 'linewidth', 1, 20, 0.5).name('Line Width').onChange((v: number) => {
            this.bolts.forEach(b => {
                b.materials[0].linewidth = v
                for (let i = 1; i < b.materials.length; i++) {
                    b.materials[i].linewidth = Math.max(0.5, v * 0.5)
                }
            })
        })
        f.addColor(this.params, 'color').name('Color').onChange((v: number) => {
            this.bolts.forEach(b => b.materials.forEach(m => m.color.set(v)))
        })

        // this.guiFolder.hide()
    }

    showGUI(v: boolean) {
        v ? this.guiFolder.show() : this.guiFolder.hide()
    }

    setVisible(v: boolean) {
        this.group.visible = v
    }

    onBPMBeat() {
        for (let i = 0; i < 5; i++) {
            this.spawnBolt()
        }
    }

    update() {
        for (let i = this.bolts.length - 1; i >= 0; i--) {
            const bolt = this.bolts[i]
            bolt.life--

            const flicker = Math.random() > 0.85 ? 0 : 1
            const opacity = (bolt.life / bolt.maxLife) * flicker
            bolt.materials[0].opacity = 1
            for (let j = 1; j < bolt.materials.length; j++) {
                bolt.materials[j].opacity = opacity * 0.8
            }

            if (bolt.life <= 0) {
                this.removeBolt(bolt)
                this.bolts.splice(i, 1)
            }
        }

        if (this.bolts.length < this.params.boltCount && Math.random() < this.params.spawnRate) {
            this.spawnBolt()
        }
    }

    leave() {
        this.bolts.forEach(b => this.removeBolt(b))
        this.bolts = []
        this.scene.remove(this.group)
    }
}
