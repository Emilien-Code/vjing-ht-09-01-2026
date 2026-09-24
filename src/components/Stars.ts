import Component from "../../classes/Component";
import type Experience from "../../Experience";
import * as THREE from 'three/webgpu'
export default class Stars extends Component{

    private experience : Experience
    private stars : THREE.Group


    constructor(experience : Experience){
        
        super()
        this.experience = experience

        const g = new THREE.BufferGeometry()
        const particlesGeometry = new THREE.BufferGeometry()
        const count = 500

        const positions = new Float32Array(count * 3) 

        for(let i = 0; i < count * 3; i++) // Multiply by 3 for same reason
        {
            positions[i] = (Math.random() - 0.5) * 20 // Math.random() - 0.5 to have a random value between -0.5 and +0.5
        }


        particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)) 
        const particlesMaterial = new THREE.PointsMaterial({
            size: 0.02,
            sizeAttenuation: true
        })

        const particles = new THREE.Points(particlesGeometry, particlesMaterial)
        this.stars = new THREE.Group().add(particles)
        
        this.stars.position.z = -10       
        this.experience.scene.add(this.stars)
    }  


    show() {
        this.stars.visible = true
    }
    hide(){
        this.stars.visible = false
    }
    update(){

    }

}
