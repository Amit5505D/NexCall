import React, { useEffect, useRef, useState } from 'react'
import io from "socket.io-client";
import { Badge, IconButton, TextField } from '@mui/material';
import { Button } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff'
// import styles from "../styles/videoComponent.module.css"; // Removed: Styles are now in a <style> tag
import CallEndIcon from '@mui/icons-material/CallEnd'
import MicIcon from '@mui/icons-material/Mic'
import MicOffIcon from '@mui/icons-material/MicOff'
import ScreenShareIcon from '@mui/icons-material/ScreenShare';
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare'
import ChatIcon from '@mui/icons-material/Chat'
import server from '../environment.js'; // Removed: Server URL is now defined below

// --- 🔴 CRITICAL FIX HERE 🔴 ---
//
// Change "8000" to whatever port your server (socketmanager.js) is running on.
// If your server is on port 3001, change this to "http://localhost:3001"
//
const server_url = "http://localhost:8000"; 
//
// --- 🔴 END OF FIX 🔴 ---


// This object holds all the RTCPeerConnection instances, keyed by socketId
var connections = {};

const peerConfigConnections = {
    "iceServers": [
        { "urls": "stun:stun.l.google.com:19302" },
        { "urls": "stun:stun1.l.google.com:19302" }
    ]
}

export default function VideoMeetComponent() {

    var socketRef = useRef();
    let socketIdRef = useRef();
    let localVideoref = useRef();

    let [videoAvailable, setVideoAvailable] = useState(false);
    let [audioAvailable, setAudioAvailable] = useState(false);
    let [video, setVideo] = useState(false);
    let [audio, setAudio] = useState(false);
    let [screen, setScreen] = useState(false);
    let [showModal, setModal] = useState(false);
    let [screenAvailable, setScreenAvailable] = useState(false);
    let [messages, setMessages] = useState([])
    let [message, setMessage] = useState("");
    let [newMessages, setNewMessages] = useState(0);
    let [askForUsername, setAskForUsername] = useState(true);
    let [username, setUsername] = useState("");

    const videoRef = useRef([])
    let [videos, setVideos] = useState([])

    useEffect(() => {
        console.log("Component mounted");
        
        const getLobbyMedia = async () => {
            let stream = null;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                console.log('Video and audio permission granted');
                setVideoAvailable(true);
                setAudioAvailable(true);

                window.localStream = stream;
                
                if (localVideoref.current) {
                    localVideoref.current.srcObject = stream;
                }

                // Keep tracks disabled for the lobby preview
                stream.getTracks().forEach(track => track.enabled = false);

            } catch (e) {
                console.log(`Error getting media for lobby: ${e.message}`); // More detailed error
                setVideoAvailable(false);
                setAudioAvailable(false);
            }

            if (navigator.mediaDevices.getDisplayMedia) {
                setScreenAvailable(true);
            }
        };

        getLobbyMedia();

        return () => {
            console.log("Cleaning up component");
            if (window.localStream) {
                window.localStream.getTracks().forEach(track => track.stop());
            }
            if (socketRef.current) {
                socketRef.current.disconnect();
            }
            for (let id in connections) {
                if (connections[id]) {
                    connections[id].close();
                }
            }
        }
    }, [])

    // This useEffect now handles attaching the stream
    useEffect(() => {
        if (!askForUsername && localVideoref.current && window.localStream) {
            // We are in the meeting room.
            // Just attach the stream. Tracks were enabled in the `connect` function.
            localVideoref.current.srcObject = window.localStream;
        }
    }, [askForUsername]); // Only depend on askForUsername

    const createEmptyStream = () => {
        console.log("Creating empty black/silent stream."); // Log fallback
        const silence = () => {
            let ctx = new AudioContext();
            let oscillator = ctx.createOscillator();
            let dst = oscillator.connect(ctx.createMediaStreamDestination());
            oscillator.start();
            ctx.resume();
            return Object.assign(dst.stream.getAudioTracks()[0], { enabled: false });
        };

        const black = ({ width = 640, height = 480 } = {}) => {
            let canvas = Object.assign(document.createElement("canvas"), { width, height });
            canvas.getContext('2d').fillRect(0, 0, width, height);
            let stream = canvas.captureStream();
            return Object.assign(stream.getVideoTracks()[0], { enabled: false });
        };

        return new MediaStream([black(), silence()]);
    }

    // Updated connect function to enable tracks *before* re-rendering
    let connect = () => {
        if (!window.localStream) {
            console.log("No local stream, creating empty one");
            window.localStream = createEmptyStream();
        }
        
        // Enable tracks *directly* before setting state
        const videoTrack = window.localStream.getVideoTracks()[0];
        const audioTrack = window.localStream.getAudioTracks()[0];
        
        if (videoTrack && videoAvailable) {
            videoTrack.enabled = true;
            console.log("Video track enabled");
        }
        if (audioTrack && audioAvailable) {
            audioTrack.enabled = true;
            console.log("Audio track enabled");
        }
        
        // Set state *after* enabling tracks
        setVideo(videoAvailable);
        setAudio(audioAvailable);
        
        connectToSocketServer();
        
        // This state change will trigger the re-render
        setAskForUsername(false); 
    }
    
    let handleVideo = () => {
        const newVideoState = !video;
        setVideo(newVideoState);
        if (window.localStream) {
            const videoTrack = window.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = newVideoState;
            }
        }
    }
    
    let handleAudio = () => {
        const newAudioState = !audio;
        setAudio(newAudioState);
        if (window.localStream) {
            const audioTrack = window.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = newAudioState;
            }
        }
    }

    const updatePeerTracks = (stream) => {
        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];

        for (let id in connections) {
            if (id === socketIdRef.current) continue;

            const conn = connections[id];

            let videoSender = conn.getSenders().find(s => s.track && s.track.kind === 'video');
            if (videoSender) {
                videoSender.replaceTrack(videoTrack).catch(e => console.log(`replaceTrack video error: ${e}`));
            }

            let audioSender = conn.getSenders().find(s => s.track && s.track.kind === 'audio');
            if (audioSender) {
                audioSender.replaceTrack(audioTrack).catch(e => console.log(`replaceTrack audio error: ${e}`));
            }
        }
    }

    let handleScreen = async () => {
        if (!screen) { 
            let screenStream;
            try {
                screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            } catch (e) {
                console.log("Screen share error:", e);
                return;
            }

            window.screenStream = screenStream;
            setScreen(true);
            updatePeerTracks(screenStream);
            localVideoref.current.srcObject = screenStream;

            screenStream.getVideoTracks()[0].onended = () => {
                handleScreen(); // Toggle off
            };

        } else { 
            if (window.screenStream) {
                window.screenStream.getTracks().forEach(track => track.stop());
                window.screenStream = null;
            }

            setScreen(false);
            updatePeerTracks(window.localStream);
            localVideoref.current.srcObject = window.localStream;
        }
    }

    let gotMessageFromServer = (fromId, message) => {
        var signal = JSON.parse(message)

        if (fromId !== socketIdRef.current) {
            if (!connections[fromId]) {
                console.log("Connection not found for", fromId);
                return;
            }
            if (signal.sdp) {
                connections[fromId].setRemoteDescription(new RTCSessionDescription(signal.sdp)).then(() => {
                    if (signal.sdp.type === 'offer') {
                        connections[fromId].createAnswer().then((description) => {
                            connections[fromId].setLocalDescription(description).then(() => {
                                socketRef.current.emit('signal', fromId, JSON.stringify({ 'sdp': connections[fromId].localDescription }))
                            }).catch(e => console.log("setLocalDescription error:", e))
                        }).catch(e => console.log("createAnswer error:", e))
                    }
                }).catch(e => console.log("setRemoteDescription error:", e))
            }

            if (signal.ice) {
                connections[fromId].addIceCandidate(new RTCIceCandidate(signal.ice)).catch(e => console.log("addIceCandidate error:", e))
            }
        }
    }

    let connectToSocketServer = () => {
        // --- THIS WILL NOW LOG THE CORRECT URL ---
        console.log(`Attempting to connect to server at: ${server_url}`);
        
        socketRef.current = io.connect(server_url, { 
            secure: false,
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
        })

        socketRef.current.on('signal', gotMessageFromServer)

        socketRef.current.on('connect', () => {
            console.log("✅ Connected to socket server. My ID:", socketRef.current.id);
            socketRef.current.emit('join-call', window.location.href)
            socketIdRef.current = socketRef.current.id

            socketRef.current.on('chat-message', addMessage)

            socketRef.current.on('user-left', (id) => {
                console.log("❌ User left:", id);
                
                setVideos((prevVideos) => prevVideos.filter((video) => video.socketId !== id));
                
                if (connections[id]) {
                    connections[id].close();
                    delete connections[id];
                }
            })

            // --- THIS IS THE CRITICAL FIX FOR MULTI-USER ---
            socketRef.current.on('user-joined', (id, clients) => {
                console.log("👤 USER-JOINED EVENT RECEIVED!");
                console.log("   New User's ID:", id);
                console.log("   All clients in room:", clients);
                console.log("   My socket ID:", socketIdRef.current);

                const setupConnection = (peerId) => {
                    if (connections[peerId]) {
                        console.log(`   ⏭️ Connection to ${peerId} already exists. Skipping.`);
                        return;
                    }

                    console.log(`   🔗 Creating new peer connection to: ${peerId}`);
                    connections[peerId] = new RTCPeerConnection(peerConfigConnections);

                    connections[peerId].onicecandidate = function (event) {
                        if (event.candidate != null) {
                            console.log(`   📤 Sending ICE candidate to ${peerId}`);
                            socketRef.current.emit('signal', peerId, JSON.stringify({ 'ice': event.candidate }));
                        }
                    };

                    connections[peerId].ontrack = (event) => {
                        console.log(`   📹 Received track from: ${peerId}`);
                        
                        setVideos(prevVideos => {
                            const videoExists = prevVideos.find(v => v.socketId === peerId);

                            if (videoExists) {
                                console.log(`   🔄 Updating existing video for: ${peerId}`);
                                const updatedVideos = prevVideos.map(video =>
                                    video.socketId === peerId ? { ...video, stream: event.streams[0] } : video
                                );
                                videoRef.current = updatedVideos;
                                return updatedVideos;
                            } else {
                                console.log(`   ✨ Creating new video for: ${peerId}`);
                                const newVideo = {
                                    socketId: peerId,
                                    stream: event.streams[0],
                                    autoplay: true,
                                    playsinline: true
                                };
                                const updatedVideos = [...prevVideos, newVideo];
                                videoRef.current = updatedVideos;
                                return updatedVideos;
                            }
                        });
                    };

                    if (window.localStream) {
                        window.localStream.getTracks().forEach(track => {
                            console.log(`   ➕ Adding track (${track.kind}) to peer: ${peerId}`);
                            connections[peerId].addTrack(track, window.localStream);
                        });
                    }
                };
                
                if (id === socketIdRef.current) {
                    // I AM THE NEW USER
                    console.log("   I am the new user. Connecting to all existing peers.");
                    clients.forEach((peerId) => {
                        if (peerId === socketIdRef.current) return;
                        setupConnection(peerId);

                        console.log(`   📤 Creating offer for: ${peerId}`);
                        connections[peerId].createOffer()
                            .then((description) => {
                                connections[peerId].setLocalDescription(description)
                                    .then(() => {
                                        socketRef.current.emit('signal', peerId, JSON.stringify({ 'sdp': connections[peerId].localDescription }));
                                    })
                                    .catch(e => console.log("setLocalDescription error: ", e));
                            })
                            .catch(e => console.log("createOffer error: ", e));
                    });
                } else {
                    // I AM AN EXISTING USER
                    console.log(`   A new user (${id}) has joined. Connecting to them.`);
                    setupConnection(id);
                }
            });
            // --- END OF MULTI-USER FIX ---
        })

        socketRef.current.on('connect_error', (err) => {
            // This log is now CRITICAL
            console.log(`❌ FAILED TO CONNECT TO SERVER at ${server_url}. Error: ${err.message}`);
        });
    }

    let handleEndCall = () => {
        try {
            if (window.localStream) {
                window.localStream.getTracks().forEach(track => track.stop())
            }
            if (window.screenStream) {
                window.screenStream.getTracks().forEach(track => track.stop())
            }
        } catch (e) { }
        
        for (let id in connections) {
            if(connections[id]) connections[id].close();
        }
        
        if (socketRef.current) {
            socketRef.current.disconnect();
        }

        window.location.href = "/" // Go back to home
    }

    const addMessage = (data, sender, socketIdSender) => {
        setMessages((prevMessages) => [
            ...prevMessages,
            { sender: sender, data: data }
        ]);
        if (socketIdSender !== socketIdRef.current) {
            setNewMessages((prevNewMessages) => prevNewMessages + 1);
        }
    };

    let sendMessage = () => {
        if(message.trim() === "") return;
        socketRef.current.emit('chat-message', message, username)
        setMessage("");
    }

    const styles = {
        meetVideoContainer: {
            position: 'relative',
            width: '100vw',
            height: '100vh',
            background: '#202124',
            color: 'white',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
        },
        conferenceView: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '10px',
            padding: '10px',
            width: '100%',
            height: '100%',
            paddingBottom: '80px', // Space for buttons
        },
        conferenceVideo: {
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            borderRadius: '8px',
            background: '#333',
            transform: 'scaleX(-1)', // Mirror remote videos
        },
        meetUserVideo: {
            position: 'absolute',
            bottom: '90px',
            right: '20px',
            width: '200px',
            borderRadius: '8px',
            border: '2px solid white',
            transform: 'scaleX(-1)', // Mirror local video
            zIndex: 5,
            transition: 'all 0.3s ease',
            background: '#333',
        },
        buttonContainers: {
            position: 'absolute',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.5)',
            borderRadius: '25px',
            padding: '10px 20px',
            display: 'flex',
            gap: '15px',
            zIndex: 10,
        },
        chatRoom: {
            position: 'absolute',
            top: 0,
            right: 0,
            width: '300px',
            height: '100%',
            background: '#fff',
            color: '#333',
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '-5px 0 15px rgba(0,0,0,0.2)',
        },
        chatContainer: {
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            padding: '10px',
        },
        chattingDisplay: {
            flexGrow: 1,
            overflowY: 'auto',
            padding: '10px 5px',
            borderTop: '1px solid #ccc',
            borderBottom: '1px solid #ccc',
            marginBottom: '10px',
        },
        chattingArea: {
            display: 'flex',
            gap: '10px',
            paddingTop: '10px',
        }
    };

    return (
        <div>
            {askForUsername === true ?
                <div style={{ textAlign: 'center', padding: '50px' }}>
                    <h2>Enter into Lobby</h2>
                    <TextField 
                        id="outlined-basic" 
                        label="Username" 
                        value={username} 
                        onChange={e => setUsername(e.target.value)} 
                        variant="outlined"
                        style={{ marginRight: '10px' }}
                    />
                    <Button variant="contained" onClick={connect} disabled={!username.trim()}>Connect</Button>
                    <div style={{ marginTop: '20px', backgroundColor: '#222', display: 'inline-block', borderRadius: '10px' }}>
                        <video ref={localVideoref} autoPlay muted style={{ width: '300px', borderRadius: '10px', transform: 'scaleX(-1)', background: '#333' }}></video>
                    </div>
                </div> :
                <div style={styles.meetVideoContainer}>
                    {showModal ? (
                        <div style={styles.chatRoom}>
                            <div style={styles.chatContainer}>
                                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                                    <h1>Chat</h1>
                                    <Button onClick={() => setModal(false)}>Close</Button>
                                </div>
                                <div style={styles.chattingDisplay}>
                                    {messages.length !== 0 ? messages.map((item, index) => (
                                        <div style={{ marginBottom: "20px" }} key={index}>
                                            <p style={{ fontWeight: "bold" }}>{item.sender}</p>
                                            <p style={{wordBreak: 'break-word'}}>{item.data}</p>
                                        </div>
                                    )) : <p>No Messages Yet</p>}
                                </div>
                                <div style={styles.chattingArea}>
                                    <TextField 
                                        value={message} 
                                        onChange={(e) => setMessage(e.target.value)} 
                                        onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                                        id="outlined-basic" 
                                        label="Enter Your chat" 
                                        variant="outlined" 
                                        fullWidth
                                        size="small"
                                    />
                                    <Button variant='contained' onClick={sendMessage}>Send</Button>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    <div style={styles.buttonContainers}>
                        <IconButton onClick={handleVideo} style={{ color: "white" }} disabled={!videoAvailable}>
                            {video === true ? <VideocamIcon /> : <VideocamOffIcon />}
                        </IconButton>
                        <IconButton onClick={handleEndCall} style={{ color: "red" }}>
                            <CallEndIcon />
                        </IconButton>
                        <IconButton onClick={handleAudio} style={{ color: "white" }} disabled={!audioAvailable}>
                            {audio === true ? <MicIcon /> : <MicOffIcon />}
                        </IconButton>
                        {screenAvailable === true ? (
                            <IconButton onClick={handleScreen} style={{ color: screen ? "#33FF33" : "white" }}>
                                {screen === false ? <ScreenShareIcon /> : <StopScreenShareIcon />}
                            </IconButton>
                        ) : null}
                        <Badge badgeContent={newMessages} max={999} color='secondary'>
                            <IconButton onClick={() => { setModal(!showModal); setNewMessages(0); }} style={{ color: "white" }}>
                                <ChatIcon />
                            </IconButton>
                        </Badge>
                    </div>

                    {/* My local video */}
                    <video style={styles.meetUserVideo} ref={localVideoref} autoPlay muted></video>

                    {/* Remote videos grid */}
                    <div style={styles.conferenceView}>
                        {videos.map((video) => (
                            <div key={video.socketId} style={{position: 'relative', background: '#333', borderRadius: '8px'}}>
                                <video
                                    style={styles.conferenceVideo}
                                    data-socket={video.socketId}
                                    ref={ref => {
                                        if (ref && video.stream) {
                                            ref.srcObject = video.stream;
                                        }
                                    }}
                                    autoPlay
                                    playsInline
                                />
                            </div>
                        ))}
                    </div>
                </div>
            }
        </div>
    )
}


