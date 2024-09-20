const express = require("express");
const app = express();
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const {PeerServer} = require("peer")

const server = http.createServer(app);

app.use(cors());

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.get("/", (req, res) => {
  res.send("Hello server is started");
});

let onlineUsers = {};
let videoRooms = {};
let chatRooms = {};

io.on("connection", (socket) => {
  console.log(`user connected of the id: ${socket.id}`);
  socket.on("user-login", (data) => loginEventHandler(socket, data));

  socket.on('chat-message', (data) => chatMessageHandler(socket,data));

  socket.on('video-room-create',(data) => videoRoomCreateHandler(socket,data) )

  socket.on("video-room-join",(data) => {
    videoRoomJoinHandler(socket,data)
  });

  socket.on("video-room-leave", (data) => {
    videoRoomLeaveHandler(socket,data)
  })

  socket.on("chat-room-create",(data) => chatRoomHandler(socket,data))
  socket.on("disconnect", () => {
    disconnectEventHandler(socket);
  });
});

const peerServer = PeerServer ({port: 9000, path: "/peer"})
const PORT = process.env.PORT || 3003;

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Socket events
const disconnectEventHandler = (socket) => {
  console.log(`user disconnected of the id: ${socket.id}`);
  checkIfUserIsInCall(socket)
  removeOnlineUser(socket.id);
  broadcastDisconnectedUserDetails(socket.id);
};

const chatMessageHandler = (socket, data) => {
  const { receiverSocketId, content, id} = data;

  if (onlineUsers[receiverSocketId]){
    console.log('message receiver')
    console.log('sending message ')
    io.to(receiverSocketId).emit('chat-message',{
      senderSocketId: socket.id,
      content,
      id,
    });
  }
};



const videoRoomLeaveHandler = (socket,data) => {
  const {roomId} =data;
  if( videoRooms[roomId]) {
    videoRooms[roomId].participants = videoRooms[roomId].participants.filter(
      (p) => p.socketId !== socket.id
    )
  }

  if(videoRooms[roomId].participants.length > 0) {
    socket.to(videoRooms[roomId].participants[0].socketId)
    .emit("video-call-disconnect");
  }

  if(videoRooms[roomId].participants.length < 1) {
    delete videoRooms[roomId];
  }

  broadcastVideoRooms();
}
 //helper function

const removeOnlineUser = (id) => {
  if (onlineUsers[id]) {
    delete onlineUsers[id];
  }
  console.log(onlineUsers);
};

const checkIfUserIsInCall = (socket) => {
  Object.entries(videoRooms).forEach(([key,value]) =>{
    const participant = value.participants.find((p) => p.socketId === socket.id)

    if (participant) {
      removeUserFromTheVideoRoom(socket.id, key)
    }
  });
 
};

const removeUserFromTheVideoRoom = (socketId, roomId) => {
  videoRooms[roomId].participants = videoRooms[roomId].participants.filter(
    (p) => p.socketId !== socketId
  );

  // remove room if no participants left in the room
  if (videoRooms[roomId].participants.length < 1) {
    delete videoRooms[roomId];
  } else {
    // if still there is a user in the room - inform him to clear his peer connection

    io.to(videoRooms[roomId].participants[0].socketId).emit(
      "video-call-disconnect"
    );
  }

  broadcastVideoRooms();

}

const broadcastDisconnectedUserDetails = (disconnectedUserSocketId) => {
  io.to("logged-users").emit("user-disconnected", disconnectedUserSocketId);
};

const broadcastVideoRooms = () => {
  io.to("logged-users").emit('video-rooms', videoRooms);
 
};

const broadcastChatRooms = () => {
   io.to("logged-users").emit('chat-rooms', chatRooms)
   
}

const videoRoomCreateHandler = (socket,data) => {
  const {peerId, newRoomId} = data;

  // adding new room
  videoRooms[newRoomId] = {
    participants: [
      {
        socketId: socket.id,
        username: onlineUsers[socket.id].username,
        peerId,
      }
    ]
  };

  broadcastVideoRooms();
  console.log("new room",data)
};

const chatRoomHandler = (socket,data) => {
  const {socketId, newChatId} = data;
  
  chatRooms[newChatId] = {
    participants: [
      {
        socketId1: socket.id,
        username: onlineUsers[socket.id].username,
        socketId,
      }
    ]
  };
  broadcastChatRooms();
  console.log("new chat room",data)

}
const convertChatRoomsToArray = (newChatId) => {
  const chatRoomsArray = [];

  // Kiểm tra xem chatRooms[newChatId] có tồn tại và participants có phải là một mảng không
  if (chatRooms[newChatId]?.participants?.length > 0) {
    chatRooms[newChatId].participants.forEach((participant) => {
      chatRoomsArray.push({
        newChatId, 
        username: participant.username,
        socketId: participant.socketId,
      });
    });
  } else {
    console.log("No participants or incorrect structure in chat room:", chatRooms[newChatId]);
  }

  return chatRoomsArray;
};


const videoRoomJoinHandler = (socket,data) => {
  const { roomId, peerId} = data;
 
 
  if(videoRooms[roomId]) {
    
      videoRooms[roomId].participants.forEach((participant) => {
        socket.to(participant.socketId).emit("video-room-init", {
          newParticipantPeerId: peerId
        });
      });
   
    videoRooms[roomId].participants = [
      ...videoRooms[roomId].participants,
      {
        socketId: socket.id,
        username: onlineUsers[socket.id].username,
        peerId,
      },
    ];
    broadcastVideoRooms();
  }
}

const getParticipantsOfVideoRoom = (socket,roomId) => {
  const participantsArray = [];
  Object.entries(videoRooms[roomId].participants).forEach(([key,value])=> {
    participantsArray.push({
      socketId: key,
      username: value.onlineUsers[socket.id].username,
      peerId
    });
  });
  return participantsArray;
}

const loginEventHandler = (socket, data) => {
  socket.join("logged-users");

  onlineUsers[socket.id] = {
    username: data.username,
    coords: data.coords,
  };
  console.log(onlineUsers);

  io.to("logged-users").emit("online-users", convertOnlineUsersToArray());
  broadcastVideoRooms(); 

};

const convertOnlineUsersToArray = () => {
  const onlineUsersArray = [];

  Object.entries(onlineUsers).forEach(([key, value]) => {
    onlineUsersArray.push({
      socketId: key,
      username: value.username,
      coords: value.coords,
    });
  });

  return onlineUsersArray;
};
