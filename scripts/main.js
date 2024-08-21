import controller from './notifications-controller.js';



const clientID='6f08b238-da06-42df-b4ce-b2edd8714ed4';
const genesysCloudRegion= 'mypurecloud.de';
const redirectUri='http://localhost/WebSocket/index.html';
//const redirectUri='http://localhost/translate/template_listener/index.html';
const customerInactivityTimeout=15;

// Obtain a reference to the platformClient object
const platformClient = require('platformClient');
const client = platformClient.ApiClient.instance;

// API instances
const usersApi = new platformClient.UsersApi();
const conversationsApi = new platformClient.ConversationsApi();


let userId = '';
let agentName = 'AGENT_NAME';
let agentAlias = 'AGENT_ALIAS';
let customerName = 'CUSTOMER_NAME';
let currentConversation = null;
let currentConversationId = '';
let previousTimerId='';

let mostRecentMessageTime = {
    'agent': '',
    'customer': ''
};

/**
 * Callback function for 'message' and 'typing-indicator' events.
 * 
 * @param {Object} data the event data  
 */
let onMessage = (data) => {
    const _prefix = `[MessageMonitor:Main] [${currentConversationId}:onMessage] `;
    //TODO: Optimize this for performance.
    //console.debug(`${_prefix}Message:${JSON.stringify(data)}`);



    console.log(`${_prefix}topic:${data.topicName}`);

    // Discard unwanted notifications
    if (data.topicName.toLowerCase() === 'channel.metadata') {
        // Heartbeat
        console.debug(`${_prefix}:Ignoring metadata: `, notification);
        return;
    } else if (data.eventBody.id != currentConversationId) {
        // Conversation event not related to the current conversationId (in this frame)
        // Ignore
        console.warn(`${_prefix}EventConversationId:${data.eventBody.conversationId}!=SessionConversationId ${currentConversationId}|Ignoring Message`);
        return;
    } else if (data.eventBody.participants.find(p => p.purpose == 'customer').endTime) {
        console.info(`${_prefix}Customer Disconnnected.`);
    } else {
        data.eventBody.participants.forEach((participant) => {
            if (!participant.endTime) {
                try{
                    mostRecentMessageTime[participant.purpose] = participant.messages[0].messages[participant.messages[0].messages.length - 1].messageTime;
                }catch(e) {
                    console.log(`${_prefix}|error getting most recent messaging time|${e}`);
                }
            }
        });
        
        console.log(`${_prefix}Update Message Time:${JSON.stringify(mostRecentMessageTime)}`);
        
        if(mostRecentMessageTime['agent'] && mostRecentMessageTime['agent'] != "" && (mostRecentMessageTime['customer'] < mostRecentMessageTime['agent'])) {
            console.log(`${_prefix}Last Message from Customer`);
            if(previousTimerId&&previousTimerId!='') {
                clearTimeout(previousTimerId);
            }
            previousTimerId=setTimeout(function(){
                console.log(`Expired Timeout for Customer Inactivity. Send Message and Disconnect Conversation.`);
                sendMessage('Expired Timeout for Customer Inactivity. Send Message and Disconnect Conversation.',currentConversationId)
                .then((data)=>{
                    conversationsApi.postConversationDisconnect(currentConversationId);
                });
                

            },customerInactivityTimeout*1000);
        } else {
            console.log(`${_prefix} Last Message from Agent`);
			    if(previousTimerId&&previousTimerId!='') {
                clearTimeout(previousTimerId);
            }

        }
        
        
    }

};

function elapsedTimeInSecs(_toCompare) {
    const diffInSecs = Math.round((new Date().getTime() - _toCompare.getTime()) / 1000);
    console.log(`Compare:${_toCompare} with current-time.${diffInSecs} secs`);
    return diffInSecs;
  }



/**
 *  Send message to the customer
 */
function sendMessage(message, conversationId) {
    let agentsArr = currentConversation.participants.filter(p => p.purpose == 'agent' && p.userId==userId);
    let agent = agentsArr[agentsArr.length - 1];
    let connectedMessagingSession=agent.messages.filter(m=>m.state=='connected' || m.state=='alerting')
    let communicationId  = connectedMessagingSession[0].id;
    const _prefix = `[MessageMonitor:Main][${conversationId}:sendMessage]`;

    return conversationsApi.postConversationsMessageCommunicationMessages(
            conversationId, communicationId,
            {
                'textBody': message
            }
        )    
}


/**
 * Set-up the channel for chat conversations
 * @param {String} conversationId 
 * @returns {Promise}
 */
function setupChatChannel(conversationId) {
    const _prefix = `[MessageMonitor:Main] [${conversationId} setupChatChannel]`;
    return controller.createChannel()
        .then(data => {
            // Subscribe to all incoming messages
            console.info(`${_prefix}setting up subscription for v2.users.${userId}.conversations`);
            return controller.addSubscription(
                `v2.users.${userId}.conversations`,
                onMessage)
                .then(data => {
                    console.info(`${_prefix}setting up subscription for v2.conversations.chats.${conversationId}.messages`)
                    return controller.addSubscription(
                        `v2.conversations.chats.${conversationId}.messages`,
                        onMessage);
                });
        });
}



/** --------------------------------------------------------------
 *                       INITIAL SETUP
 * -------------------------------------------------------------- */
const urlParams = new URLSearchParams(window.location.search);
currentConversationId = urlParams.get('conversationId');
console.log(`[${currentConversationId}:InitialSetup] Starting Messaging Monitor.ConversationId:${currentConversationId}`);
client.setPersistSettings(true, 'messaging-listener');
client.setEnvironment(genesysCloudRegion);
client.loginImplicitGrant(
    clientID,
    redirectUri,
    {
        state: JSON.stringify({
            conversationId: currentConversationId
        })
    })
    .then(data => {

        // Assign conversation id
        let stateData = JSON.parse(data.state);
        currentConversationId = stateData.conversationId;
        const _prefix = `[MessageMonitor:Main] [${currentConversationId}]`;
        console.log(`${_prefix} Authenticated.`);
        // Get Details of current User

        return usersApi.getUsersMe();
    }).then(userMe => {
        userId = userMe.id;
        agentName = userMe.name;
        agentAlias = agentName ? agentName : agentAlias;
        const _prefix = `[MessageMonitor:Main] [${currentConversationId} Agent:${agentAlias} ]`;
        console.log(`${_prefix}`)
        // Get current conversation
        console.log(`[MessageMonitor:Main]:GetConversation:${currentConversationId}`)
        return conversationsApi.getConversation(currentConversationId);
    }).then((conv) => {
        console.log(`[MessageMonitor:Main] Received Conversation:${JSON.stringify(conv)}`);

        currentConversation = conv;
        let customer = conv.participants.find(p => p.purpose == 'customer')

        if (null != customer.messages && customer.messages.length > 0) {
            customerName = 'customer';
            if (null != customer.attributes && customer.attributes.hasOwnProperty('name')) {
                customerName = customer.attributes['name'];
            }
        }
        const _prefix = `[MessageMonitor:Main] [${currentConversationId} ] `;
        console.log(`${_prefix} setting up channels`)
        return setupChatChannel(currentConversationId);

    }).then(data => {
        const _prefix = `[MessageMonitor:Main] [${currentConversationId} ] `;
        console.log(`${_prefix} Finished Setup`);

        // Error Handling
    }).catch((e) => console.log(`${currentConversationId} Initial setup had following error ${JSON.stringify(e)}`));
