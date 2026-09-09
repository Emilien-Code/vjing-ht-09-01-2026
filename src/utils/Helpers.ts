import GUI from 'lil-gui';
export default class Helpers {
    public GUI: GUI
    constructor() {
        this.GUI = new GUI(window.location.hash)
        console.log()
        if (!window.location.hash.includes('dev')) {
            this.GUI.hide()
        }
    }

}