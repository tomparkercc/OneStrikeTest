/**
 * This file manages the channel that listens to chat events.
 */
const platformClient = require('platformClient');
const notificationsApi = new platformClient.NotificationsApi();

let channel = {};
let ws = null;

// Object that will contain the subscription topic as key and the
// callback function as the value
let subscriptionMap = {
    'channel.metadata': () => {
        console.log('MessageMonitor:Notification:heartbeat.');
    }
};

/**
 * Callback function for notications event-handling.
 * It will reference the subscriptionMap to determine what function to run
 * @param {Object} event 
 */
function onSocketMessage(event){
    let data = JSON.parse(event.data);

    subscriptionMap[data.topicName](data);
}

export default {
    /**
     * Creation of the channel. If called multiple times,
     * the last one will be the active one.
     */
    createChannel(){
        return notificationsApi.postNotificationsChannels()
        .then(data => {
            console.log(`MessageMonitor:Notification: Created Notifications ChannelsData:${JSON.stringify(data)}`);
            
            channel = data;
            ws = new WebSocket(channel.connectUri);
            ws.onmessage = onSocketMessage;
            ws.onclose = function(closingEvent) {
                console.log(`MessageMonitor:Notification:Web-socket Closed.Channel:${JSON.stringify(channel)}|CloseEvent:${JSON.stringify(closingEvent)}`);
            };
            ws.onerror =function(errorEvent) {
                console.log(`MessageMonitor:Notification:Web-socket Error.Channel:${JSON.stringify(channel)}|ErrorEvent:${JSON.stringify(errorEvent)}`);
            };
        });
    },

    /**
     * Add a subscription to the channel
     * @param {String} topic PureCloud notification topic string
     * @param {Function} callback callback function to fire when the event occurs
     */
    addSubscription(topic, callback){
        let body = [{'id': topic}]
        console.debug(`MessageMonitor:Notification:Adding Subscription Topic:${topic}`);
        return notificationsApi.postNotificationsChannelSubscriptions(
                channel.id, body)
        .then((data) => {
            subscriptionMap[topic] = callback;
            console.log(`MessageMonitor:Notification:Added subscription to ${topic}`);
        });
    }
}