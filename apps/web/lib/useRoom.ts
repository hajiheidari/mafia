'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { connectSocket, getSocket } from './socket';
import type { ChatMessageDTO, ConnectionStatusPayload, RoomDTO, RealtimeErrorPayload } from '@platform/types';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'reconnected';

export interface GameStateView {
  stateVersion: number;
  view: unknown;
}

export interface UseRoomResult {
  room: RoomDTO | null;
  connectionStatus: ConnectionStatus;
  messages: ChatMessageDTO[];
  gameState: GameStateView | null;
  gameStarted: boolean;
  error: RealtimeErrorPayload | null;
  joinByCode: (code: string) => void;
  leaveRoom: () => void;
  setReady: (isReady: boolean) => void;
  sendChat: (text: string) => void;
  sendGameAction: (action: unknown) => void;
  clearError: () => void;
}

/**
 * The ONLY place room/game realtime state is derived from Socket.IO
 * events. Every screen that needs room/chat/game data goes through this
 * hook instead of attaching its own listeners — see Milestone 6 §11/§21.
 */
export function useRoom(): UseRoomResult {
  const [room, setRoom] = useState<RoomDTO | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [gameState, setGameState] = useState<GameStateView | null>(null);
  const [gameStarted, setGameStarted] = useState(false);
  const [error, setError] = useState<RealtimeErrorPayload | null>(null);
  const roomIdRef = useRef<string | null>(null);

  useEffect(() => {
    const socket = connectSocket();

    const onConnect = () => setConnectionStatus((prev) => (prev === 'reconnecting' ? 'reconnected' : 'connected'));
    const onDisconnect = () => setConnectionStatus('reconnecting');
    const onConnectionStatus = (payload: ConnectionStatusPayload) => {
      setConnectionStatus(payload.status === 'reconnected' ? 'reconnected' : 'connected');
    };
    const onRoomState = (dto: RoomDTO) => {
      roomIdRef.current = dto.id;
      setRoom(dto);
    };
    const onPlayerEvent = (payload: { room: RoomDTO }) => setRoom(payload.room);
    const onChatMessage = (message: ChatMessageDTO) => setMessages((prev) => [...prev, message]);
    const onGameStarted = () => setGameStarted(true);
    const onGameState = (payload: { stateVersion: number; view: unknown }) => {
      setGameStarted(true);
      setGameState({ stateVersion: payload.stateVersion, view: payload.view });
    };
    const onSyncRequired = ({ roomId }: { roomId: string }) => {
      socket.emit('ROOM_SYNC_REQUEST', { roomId });
    };
    const onError = (payload: RealtimeErrorPayload) => setError(payload);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('CONNECTION_STATUS', onConnectionStatus);
    socket.on('ROOM_STATE', onRoomState);
    socket.on('PLAYER_JOINED', onPlayerEvent);
    socket.on('PLAYER_LEFT', onPlayerEvent);
    socket.on('PLAYER_UPDATED', onPlayerEvent);
    socket.on('CHAT_MESSAGE', onChatMessage);
    socket.on('GAME_STARTED', onGameStarted);
    socket.on('GAME_STATE', onGameState);
    socket.on('SYNC_REQUIRED', onSyncRequired);
    socket.on('ERROR', onError);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('CONNECTION_STATUS', onConnectionStatus);
      socket.off('ROOM_STATE', onRoomState);
      socket.off('PLAYER_JOINED', onPlayerEvent);
      socket.off('PLAYER_LEFT', onPlayerEvent);
      socket.off('PLAYER_UPDATED', onPlayerEvent);
      socket.off('CHAT_MESSAGE', onChatMessage);
      socket.off('GAME_STARTED', onGameStarted);
      socket.off('GAME_STATE', onGameState);
      socket.off('SYNC_REQUIRED', onSyncRequired);
      socket.off('ERROR', onError);
    };
  }, []);

  const joinByCode = useCallback((code: string) => {
    getSocket().emit('ROOM_JOIN', { code });
  }, []);

  const leaveRoom = useCallback(() => {
    if (roomIdRef.current) getSocket().emit('ROOM_LEAVE', { roomId: roomIdRef.current });
    setRoom(null);
    setMessages([]);
    setGameState(null);
    setGameStarted(false);
    roomIdRef.current = null;
  }, []);

  const setReady = useCallback((isReady: boolean) => {
    if (!roomIdRef.current) return;
    getSocket().emit(isReady ? 'PLAYER_READY' : 'PLAYER_UNREADY', { roomId: roomIdRef.current });
  }, []);

  const sendChat = useCallback((text: string) => {
    if (!roomIdRef.current || !text.trim()) return;
    getSocket().emit('CHAT_SEND', { roomId: roomIdRef.current, text: text.trim() });
  }, []);

  const sendGameAction = useCallback((action: unknown) => {
    if (!roomIdRef.current) return;
    getSocket().emit('GAME_ACTION', {
      roomId: roomIdRef.current,
      actionId: crypto.randomUUID(),
      clientStateVersion: gameState?.stateVersion ?? 0,
      action,
    });
  }, [gameState?.stateVersion]);

  const clearError = useCallback(() => setError(null), []);

  return {
    room,
    connectionStatus,
    messages,
    gameState,
    gameStarted,
    error,
    joinByCode,
    leaveRoom,
    setReady,
    sendChat,
    sendGameAction,
    clearError,
  };
}
