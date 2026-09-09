let events : Array<{event: string, callback : (e: any)=>void}> = []
const eventBus = {
    on(event: string, callback: (e: any)=>void){
        const listener = (e: any) => callback(e.detail);
        document.addEventListener(event, listener);
        events.push({event, callback : listener})
    }, 
    dispatch(event: string, data : any){
        document.dispatchEvent(new CustomEvent(event, { detail: data }));
    }, 
    remove(event : string, callback: ()=>void){
    document.removeEventListener(event, callback);
    },
    getEvents(){
        return events
    },
    removeEvents(eventsToRemove : [string]){ 
        eventsToRemove.forEach(event => {
            events.filter((ev) => ev.event === event).forEach((event) => {
                document.removeEventListener(event.event, event.callback);
            })
            events = events.filter((ev) => ev.event !== event)
        })
    }
};

export default eventBus
