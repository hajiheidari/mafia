'use client';

import { useEffect, useRef, useState } from 'react';
import { Avatar, Button } from '@platform/ui';
import type { ChatMessageDTO } from '@platform/types';

interface ChatPanelProps {
  messages: ChatMessageDTO[];
  currentUserId: string | null;
  onSend: (text: string) => void;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function MessageList({ messages, currentUserId }: { messages: ChatMessageDTO[]; currentUserId: string | null }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  if (messages.length === 0) {
    return <p className="py-6 text-center text-sm text-white/40">هنوز پیامی ارسال نشده.</p>;
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto p-3">
      {messages.map((m) => (
        <div key={m.id} className={`flex gap-2 ${m.userId === currentUserId ? 'flex-row-reverse' : ''}`}>
          <Avatar displayName={m.displayName} size="sm" />
          <div
            className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
              m.userId === currentUserId ? 'bg-accent text-white' : 'bg-white/5 text-white'
            }`}
          >
            <div className="mb-0.5 flex items-center gap-2 text-xs opacity-70">
              <span className="font-bold">{m.displayName}</span>
              <span>{formatTime(m.createdAt)}</span>
            </div>
            <p className="break-words">{m.text}</p>
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function ChatInput({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <form
      className="flex gap-2 border-t border-white/10 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onSend(text);
        setText('');
      }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="پیام بنویس…"
        aria-label="پیام چت"
        maxLength={500}
        className="min-h-[44px] flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-accent"
      />
      <Button type="submit" className="!min-h-[44px] !px-4">
        ارسال
      </Button>
    </form>
  );
}

/** Mobile: collapsible bottom drawer. Desktop: compact side panel. Milestone 6 §14. */
export function ChatPanel({ messages, currentUserId, onSend }: ChatPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop panel */}
      <aside className="hidden md:flex md:w-72 md:shrink-0 md:flex-col md:rounded-2xl md:border md:border-white/10 md:bg-surface">
        <h2 className="border-b border-white/10 p-3 text-sm font-bold text-white/70">گفتگو</h2>
        <MessageList messages={messages} currentUserId={currentUserId} />
        <ChatInput onSend={onSend} />
      </aside>

      {/* Mobile bottom drawer */}
      <div className="md:hidden">
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-4 left-4 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-xl shadow-lg shadow-accent/40"
          aria-label="باز کردن گفتگو"
        >
          💬
        </button>
        {open && (
          <div className="fixed inset-0 z-30 flex flex-col justify-end bg-black/50" onClick={() => setOpen(false)}>
            <div
              className="flex max-h-[70vh] flex-col rounded-t-3xl border-t border-white/10 bg-surface"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-white/10 p-3">
                <h2 className="text-sm font-bold text-white/70">گفتگو</h2>
                <button onClick={() => setOpen(false)} aria-label="بستن گفتگو" className="p-1 text-white/50">
                  ✕
                </button>
              </div>
              <MessageList messages={messages} currentUserId={currentUserId} />
              <ChatInput onSend={onSend} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
