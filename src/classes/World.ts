import * as THREE from "three"
import EventEmitter from "../utils/EventEmitter";
export default class World extends EventEmitter {
    constructor() {
        super()
    }

    onReady() { }
    enter() {

    }

    leave() {

    }
    hide() {

    }

    show() {

    }

    update() {

    }

    resize() {

    }
    onBPMBeat(a: any) {

    }
    onMouseMove(e: Event) { }
    onMouseDown(e: Event) { }
    onMouseUp(e: Event) { }
    onScroll() { }
    clean() { }
    dispose(object: any, scene: THREE.Scene) {
        if (object.geometry) {
            object.geometry.dispose();
        }

        // Dispose le matériel
        if (object.material) {
            if (Array.isArray(object.material)) {
                object.material.forEach((mat: any) => mat.dispose());
            } else {
                object.material.dispose();
            }
        }

        // Retire l'objet de la scène
        scene.remove(object);
    }

}