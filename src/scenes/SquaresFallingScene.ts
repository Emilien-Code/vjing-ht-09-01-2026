import Experience from "../Experience"
import World from "../classes/World"
import Squares from "../components/Squares"
import FallingBody from "../components/FallingBody"
import GUI from "lil-gui"


type SquaresEffect = 'kick' | 'none' | 'aside'

const EFFECTS: SquaresEffect[] = ['kick', 'none', "aside"]

export default class SquaresFallingScene extends World {

    private exp: Experience
    private squares: Squares
    private fallingBody: FallingBody
    private guiFolder!: GUI
    private visible = false
    private effect: string = ""

    constructor(exp: Experience) {
        super()
        this.exp = exp
        this.squares = new Squares(exp)
        this.fallingBody = new FallingBody(exp)

        this.setupGUI()
        this.setVisible(false)
    }

    private setupGUI() {
        this.guiFolder = this.exp.helpers.GUI.addFolder('SquaresFalling')
        this.guiFolder.hide()
    }

    onReady() {
        this.squares.onReady()
    }

    setVisible(v: boolean, direction: boolean = true) {
        this.visible = v
        this.effect = '';
        if (v) {
            this.effect = EFFECTS[Math.floor(Math.random() * EFFECTS.length)]


            if (this.effect === "aside") {


                this.exp.camera.instance.position.x = -4.47
                this.exp.camera.instance.position.y = 2.04
                this.exp.camera.instance.position.z = -5

                this.exp.camera.instance.rotation.x = 0.06
                this.exp.camera.instance.rotation.y = -0.13
                this.exp.camera.instance.rotation.z = 0.01


            } else {

                this.exp.camera.instance.rotation.x = 0
                this.exp.camera.instance.rotation.y = 0
                this.exp.camera.instance.rotation.z = 0

                this.exp.camera.instance.position.x = 0
                this.exp.camera.instance.position.y = 0
                this.exp.camera.instance.position.z = -10.5
            }
        }

        this.squares.setVisible(v, direction)
        this.fallingBody.setVisible(v, this.effect, direction)
    }

    showGUI(v: boolean) {
        v ? this.guiFolder.show() : this.guiFolder.hide()
        this.squares.showGUI(v)
        this.fallingBody.showGUI(v)
    }

    onBPMBeat() {
        this.fallingBody.onBPMBeat()
        this.squares.onBPMBeat()
    }

    update() {
        if (!this.visible) return


        if (this.effect === "aside") {

            const lookTarget = this.fallingBody.gltf.scene.position.clone()
            // lookTarget.y += 0.8


            this.exp.camera.instance.lookAt(lookTarget)
        }

        this.squares.update()
        this.fallingBody.update()
    }

    leave() {
        this.squares.leave()
        this.fallingBody.leave()
    }
}
