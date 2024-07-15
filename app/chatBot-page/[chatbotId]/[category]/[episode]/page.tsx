"use client"

import ChatBox from '@/components/chat-box';
import { useState, useRef, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/components/ui/use-toast';
import { Toaster } from '@/components/ui/toaster';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ChatbotDetailData from '@/components/chatbot-detail';
import LikeButton from '@/components/like';
import { RealtimeChannel } from '@supabase/supabase-js';

type Category = {
    id: number;
    name: string;
};

type Episode = {
    id: number;
    chatbot_id: number;
    episode_number: number;
};

type DetailData = {
    id: number;
    name: string;
    chatbot_desc: string;
    content_desc: string;
    img: string;
    ott_link: string;
    likes: number;
    msg_count: number;
}

export default function ChatBotPage({ params }: { params: { chatbotId: string, category: string, episode: string } }) {
    const [chatbot, setChatbot] = useState<any>(null);
    const [messages, setMessages] = useState<any[]>([]);
    const [inputMessage, setInputMessage] = useState<string>('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [playingIndex, setPlayingIndex] = useState<number | null>(null);
    const [chatroomId, setChatroomId] = useState<number | null>(null);
    const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
    const [isLoadingMessages, setIsLoadingMessages] = useState<boolean>(true);
    const [categories, setCategories] = useState<Category[]>([]);
    const [episodes, setEpisodes] = useState<Episode[]>([]);
    const [detailData, setDetailData] = useState<DetailData[]>([]);
    const [selectedCategory, setSelectedCategory] = useState(params.category);
    const [selectedEpisode, setSelectedEpisode] = useState(params.episode);

    const [animatingMessageId, setAnimatingMessageId] = useState<string | null>(null);
    const [animatingText, setAnimatingText] = useState('');
    const [realtimeChannel, setRealtimeChannel] = useState<RealtimeChannel | null>(null);
    const [isAnimating, setIsAnimating] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();
    const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
    const supabase = createClient()
    const router = useRouter()
    const storageKey = `chatMessages_${params.chatbotId}_${params.category}_${params.episode}`;

    useEffect(() => {
        const initializePage = async () => {
            await fetchChatbot();
            await fetchCategoriesAndEpisodes();
            await checkLoginStatus();
        };

        initializePage();
    }, [params.chatbotId, params.category, params.episode]);

    useEffect(() => {
        if (!chatroomId) return;

        const channel = supabase.channel(`chatroom:${chatroomId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `chatroom_id=eq.${chatroomId}`
            }, handleNewMessage)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'messages',
                filter: `chatroom_id=eq.${chatroomId}`
            }, handleUpdateMessage)
            .on('postgres_changes', {
                event: 'DELETE',
                schema: 'public',
                table: 'messages',
                filter: `chatroom_id=eq.${chatroomId}`
            }, handleDeleteMessageFromSupabase)
            .subscribe();

        setRealtimeChannel(channel);

        return () => {
            if (realtimeChannel) {
                supabase.removeChannel(channel);
            }
        };
    }, [chatroomId]);

    const handleNewMessage = (payload: any) => {
        const newMessage = {
            id: payload.new.id,
            text: payload.new.text,
            sender: payload.new.role,
            date: payload.new.date
        };

        if (newMessage.sender === 'assistant') {
            setAnimatingMessageId(newMessage.id);
            setAnimatingText('');
            animateMessage(newMessage.text, newMessage.id);
        } else {
            setMessages(prevMessages => [...prevMessages, newMessage]);
        }
    };

    const handleUpdateMessage = (payload: any) => {
        const updatedMessage = payload.new;
        setMessages(prevMessages =>
            prevMessages.map(msg =>
                msg.id === updatedMessage.id
                    ? { ...msg, text: updatedMessage.text }
                    : msg
            )
        );
    };

    const handleDeleteMessageFromSupabase = (payload: any) => {
        const deletedMessageId = payload.old.id;
        setMessages(prevMessages =>
            prevMessages.filter(msg => msg.id !== deletedMessageId)
        );
    };


    // 새로운 useEffect 추가
    useEffect(() => {
        if (chatbot && !isLoadingMessages && messages.length === 0) {
            checkAndGenerateWelcomeMessage();
        }
    }, [chatbot, isLoadingMessages, messages.length]);

    const checkAndGenerateWelcomeMessage = async () => {
        if (isLoggedIn && chatroomId) {
            const { data, error } = await supabase
                .from('messages')
                .select('id, text, date')
                .eq('chatroom_id', chatroomId)
                .eq('role', 'assistant')
                .order('date', { ascending: true })
                .limit(1);

            if (error) {
                console.error('Error checking welcome message:', error);
                return;
            }

            if (data && data.length === 0) {
                await generateWelcomeMessage();
            } else if (data && data.length > 0) {
                setMessages([{ id: data[0].id, text: data[0].text, sender: 'assistant', date: data[0].date }]);
            }
        } else if (!isLoggedIn) {
            const storedMessages = sessionStorage.getItem(storageKey);
            if (!storedMessages || JSON.parse(storedMessages).length === 0) {
                await generateWelcomeMessage();
            } else {
                setMessages(JSON.parse(storedMessages));
            }
        }
    }

    const generateWelcomeMessage = async () => {
        if (chatbot) {
            const welcomeMessage = `안녕하세요! ${chatbot.name}입니다. 무엇을 도와드릴까요?`;

            if (isLoggedIn && chatroomId) {
                const { data, error } = await supabase
                    .from('messages')
                    .insert({
                        chatroom_id: chatroomId,
                        role: 'assistant',
                        text: welcomeMessage,
                        date: new Date().toISOString()
                    })
                    .select()
                    .single();

                if (error) {
                    console.error('Error generating welcome message:', error);
                    return;
                }
            } else {
                const newMessage = { id: Date.now().toString(), text: welcomeMessage, sender: 'assistant', date: new Date().toISOString() };
                setAnimatingMessageId(newMessage.id);
                setAnimatingText('');
                await animateMessage(welcomeMessage, newMessage.id);
                setMessages([newMessage]);  // 이 줄을 수정
                saveMessagesToSessionStorage([newMessage]);
            }
        }
    }

    const animateMessage = async (text: string, messageId: string) => {
        setIsAnimating(true);
        let animatedText = '';
        for (let i = 0; i < text.length; i++) {
            animatedText += text[i];
            setAnimatingText(animatedText);
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        setMessages(prev => [...prev, { id: messageId, text, sender: 'assistant', date: new Date().toISOString() }]);
        setAnimatingMessageId(null);
        setAnimatingText('');
        setIsAnimating(false);
        scrollToBottom();
    };

    const fetchChatbot = async () => {
        const { data, error } = await supabase
            .from('chatbots')
            .select('*')
            .eq('id', params.chatbotId)
            .single();

        if (error) {
            console.error('Error fetching chatbot:', error);
            return;
        }

        if (data) {
            setChatbot(data as DetailData);
            // Chatbot의 상세 정보를 다른 state 변수에 저장할 수 있습니다.
            setDetailData([data as DetailData]);
        }
    };

    const checkLoginStatus = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        setIsLoggedIn(!!user);
        if (user) {
            await fetchOrCreateChatroom(user.id);
        } else {
            setIsLoadingMessages(false);
            loadMessagesFromSessionStorage();
        }
    }

    const fetchCategoriesAndEpisodes = async () => {
        const { data: categoriesData, error: categoriesError } = await supabase
            .from('chatbot_categories')
            .select('categories(id, name)')
            .eq('chatbot_id', params.chatbotId);

        if (categoriesError) {
            console.error('Error fetching categories:', categoriesError);
        } else {
            // 타입 단언을 사용하여 타입 오류 해결
            setCategories(categoriesData.map((item: any) => item.categories) as Category[]);
        }

        const { data: episodesData, error: episodesError } = await supabase
            .from('episodes')
            .select('*')
            .eq('chatbot_id', params.chatbotId)
            .order('episode_number', { ascending: true });

        if (episodesError) {
            console.error('Error fetching episodes:', episodesError);
        } else {
            // 타입 단언을 사용하여 타입 오류 해결
            setEpisodes(episodesData as Episode[]);
        }
    };

    const saveMessagesToSessionStorage = (newMessages: any[]) => {
        sessionStorage.setItem(storageKey, JSON.stringify(newMessages));
    }

    const loadMessagesFromSessionStorage = () => {
        const storedMessages = sessionStorage.getItem(storageKey);
        if (storedMessages) {
            setMessages(JSON.parse(storedMessages));
        } else {
            generateWelcomeMessage();
        }
    }

    const saveChatroomId = (id: number) => localStorage.setItem(`chatroomId_${params.chatbotId}_${params.category}_${params.episode}`, id.toString());
    const loadChatroomId = () => Number(localStorage.getItem(`chatroomId_${params.chatbotId}_${params.category}_${params.episode}`));

    const fetchOrCreateChatroom = async (userId: string) => {
        const existingId = loadChatroomId();
        if (existingId) {
            setChatroomId(existingId);
            await fetchMessages(existingId);
            return;
        }

        const { data: newChatroom, error: insertError } = await supabase.rpc('create_unique_chatroom', {
            p_uuid: userId,
            p_cuid: params.chatbotId,
            p_category: params.category,
            p_episode: params.episode
        });

        if (newChatroom) {
            const newChatroomId = newChatroom[0].chatroom_id;
            saveChatroomId(newChatroomId);
            setChatroomId(newChatroomId);
            await fetchMessages(newChatroomId);
        } else if (insertError) {
            console.error('Error creating or fetching chatroom:', insertError);
        }
    };

    const fetchMessages = async (chatroomId: number) => {
        const { data: messages, error } = await supabase
            .from('messages')
            .select('id, text, role, date')
            .eq('chatroom_id', chatroomId)
            .order('date', { ascending: true });

        if (error) {
            console.error('Error fetching messages:', error);
            return;
        }

        const formattedMessages = messages.map(msg => ({
            id: msg.id,
            text: msg.text,
            sender: msg.role,
            date: msg.date
        }));

        setMessages(formattedMessages);
        setIsLoadingMessages(false);
    }

    const generateBotResponse = async (text: string) => {
        setIsGenerating(true);
        const newMessage = {
            id: Date.now().toString(),
            text,
            sender: 'assistant',
            date: new Date().toISOString()
        };

        if (isLoggedIn && chatroomId) {
            await supabase
                .from('messages')
                .insert({
                    chatroom_id: chatroomId,
                    role: newMessage.sender,
                    text: newMessage.text,
                    date: newMessage.date
                });
            // 실시간 이벤트가 이 메시지를 처리할 것입니다.
        } else {
            setAnimatingMessageId(newMessage.id);
            setAnimatingText('');
            await animateMessage(text, newMessage.id);

            setMessages(prevMessages => {
                saveMessagesToSessionStorage(prevMessages);
                return prevMessages;
            });
        }

        setIsGenerating(false);
    };

    const scrollToBottom = () => {
        setTimeout(() => {
            if (messagesEndRef.current) {
                messagesEndRef.current.scrollIntoView({
                    behavior: "smooth",
                    block: "end",
                    inline: "nearest"
                });
            }
        }, 0);
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, animatingMessageId]);

    const handleSendMessage = async () => {
        if (inputMessage.trim() === '') return;

        if (messages.length >= 19 && !isLoggedIn) {
            toast({
                title: "로그인 필요",
                description: "더 많은 대화를 위해 로그인이 필요합니다.",
                action: <Button onClick={() => router.push('/login')}>로그인</Button>,
            })
            return;
        }

        const newMessage = {
            id: Date.now().toString(), // 고유 ID 추가
            text: inputMessage,
            sender: 'user',
            date: new Date().toISOString()
        };

        setInputMessage('');

        if (isLoggedIn && chatroomId) {
            await supabase
                .from('messages')
                .insert({
                    chatroom_id: chatroomId,
                    role: newMessage.sender,
                    text: newMessage.text,
                    date: newMessage.date
                });
            // 실시간 이벤트가 이 메시지를 처리할 것입니다.
        } else {
            setMessages(prevMessages => {
                const updatedMessages = [...prevMessages, newMessage];
                saveMessagesToSessionStorage(updatedMessages);
                return updatedMessages;
            });
        }

        // 봇 응답 생성
        setTimeout(() => {
            const botResponse = `Response from ${chatbot.name}`;
            generateBotResponse(botResponse);
        }, 500);
    };

    const saveMessage = async (message: any) => {
        if (isLoggedIn && chatroomId) {
            const { data, error } = await supabase
                .from('messages')
                .insert({ chatroom_id: chatroomId, role: message.sender, text: message.text, date: message.date })
                .select()
                .single();

            if (error) {
                console.error('Error saving message:', error);
                return null;
            }
            return data;
        } else {
            const newMessages = [...messages, message];
            saveMessagesToSessionStorage(newMessages);
            return message;
        }
    };

    const handleDeleteMessage = async (index: number) => {
        const messageToDelete = messages[index];

        if (isLoggedIn && chatroomId) {
            // 선택한 메시지와 그 이후의 모든 메시지 삭제
            const { error } = await supabase
                .from('messages')
                .delete()
                .eq('chatroom_id', chatroomId)
                .gte('date', messageToDelete.date);

            if (error) {
                console.error('Error deleting messages:', error);
                return;
            }
            // Realtime 이벤트가 삭제를 처리할 것이므로 여기서 상태를 직접 업데이트하지 않습니다.
        } else {
            // 비로그인 상태에서는 직접 상태를 업데이트합니다.
            const newMessages = messages.slice(0, index);
            setMessages(newMessages);
            saveMessagesToSessionStorage(newMessages);
        }

        if (index === 0) {
            return;
        } else if (messageToDelete.sender === 'assistant' && !isLoggedIn) {
            // 비로그인 상태에서만 새 응답을 즉시 생성합니다.
            setTimeout(() => {
                const botResponse = `New response after deletion from ${chatbot.name}`;
                generateBotResponse(botResponse);
            }, 500);
        }
    };

    const handleEditMessage = async (index: number, newText: string) => {
        const messageToUpdate = messages[index];

        if (isLoggedIn && chatroomId) {
            await supabase
                .from('messages')
                .update({ text: newText })
                .eq('id', messageToUpdate.id);
        } else {
            setMessages(prev => prev.map((msg, i) => i === index ? { ...msg, text: newText } : msg));
            saveMessagesToSessionStorage(messages.map((msg, i) => i === index ? { ...msg, text: newText } : msg));
        }

        if (messageToUpdate.sender === 'user') {
            setTimeout(() => {
                const botResponse = `New response after edit from ${chatbot?.name}`;
                generateBotResponse(botResponse);
            }, 500);
        }
    };

    const handleCopyMessage = (text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            toast({
                title: "복사 완료",
                description: "메시지가 클립보드에 복사되었습니다.",
            });
        }).catch(err => {
            console.error('복사 실패:', err);
            toast({
                title: "복사 실패",
                description: "메시지 복사 중 오류가 발생했습니다.",
                variant: "destructive",
            });
        });
    };

    const handleRegenerateMessage = async (index: number) => {
        if (isLoggedIn && chatroomId) {
            // 선택한 메시지 이후의 모든 메시지 삭제
            const { error: deleteError } = await supabase
                .from('messages')
                .delete()
                .eq('chatroom_id', chatroomId)
                .gte('id', messages[index].id);

            if (deleteError) {
                console.error('Error deleting subsequent messages:', deleteError);
                return;
            }
        }

        // 상태에서 메시지 삭제
        setMessages(prev => prev.slice(0, index));

        if (!isLoggedIn) {
            saveMessagesToSessionStorage(messages.slice(0, index));
        }

        // 새로운 봇 응답 생성
        setTimeout(() => {
            const botResponse = `Regenerated response from ${chatbot.name}`;
            generateBotResponse(botResponse);
        }, 500);
    };

    const handleTogglePlay = (index: number) => {
        if (playingIndex === index) {
            window.speechSynthesis.cancel();
            setPlayingIndex(null);
        } else {
            if (playingIndex !== null) {
                window.speechSynthesis.cancel();
            }

            const text = messages[index].text;
            utteranceRef.current = new SpeechSynthesisUtterance(text);
            utteranceRef.current.onend = () => setPlayingIndex(null);
            window.speechSynthesis.speak(utteranceRef.current);
            setPlayingIndex(index);
        }
    };

    return (
        <div className='flex flex-col h-[calc(100vh-200px)] max-w-4xl mx-auto p-6 bg-zinc-100 rounded-lg shadow-lg'>
            <div className='flex items-center justify-between mb-6 ml-2'> {/* justify-between을 추가하여 오른쪽으로 정렬 */}
                <div className='w-14 h-14 bg-zinc-300 rounded-full mr-4'></div>

                <div className='flex flex-grow'> {/* Select 컴포넌트를 포함하는 Flex 컨테이너 */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Label className='text-2xl font-bold text-zinc-800'>{chatbot ? chatbot.name : '로딩 중...'}</Label>
                        </PopoverTrigger>
                        <PopoverContent className="w-150 p-5">
                            {chatbot && (
                                <ChatbotDetailData
                                    id={chatbot.id}
                                    name={chatbot.name}
                                    chatbot_desc={chatbot.chatbot_desc}
                                    content_desc={chatbot.content_desc}
                                    img={chatbot.img}
                                    ott_link={chatbot.ott_link}
                                    likes={chatbot.likes}
                                    msg_count={chatbot.msg_count}
                                />
                            )}

                        </PopoverContent>
                    </Popover>
                    <div className='flex ml-auto'> {/* ml-auto를 사용하여 오른쪽으로 밀어줍니다 */}
                        <Select
                            value={selectedCategory}
                            onValueChange={(value) => {
                                setSelectedCategory(value);
                                router.push(`/chatBot-page/${params.chatbotId}/${value}/${selectedEpisode}`);
                            }}
                        >
                            <SelectTrigger className="w-[180px] ml-4">
                                <SelectValue>{categories.find(c => c.id.toString() === selectedCategory)?.name || "카테고리 선택"}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                {categories.map((category) => (
                                    <SelectItem key={category.id} value={category.id.toString()}>{category.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <Select
                            value={selectedEpisode}
                            onValueChange={(value) => {
                                setSelectedEpisode(value);
                                router.push(`/chatBot-page/${params.chatbotId}/${selectedCategory}/${value}`);
                            }}
                        >
                            <SelectTrigger className="w-[80px] ml-4">
                                <SelectValue>{episodes.find(e => e.id.toString() === selectedEpisode)?.episode_number + '회' || "회차 선택"}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                {episodes.map((episode) => (
                                    <SelectItem key={episode.id} value={episode.id.toString()}>{episode.episode_number}회</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>

            <ScrollArea className='flex-grow mb-6 p-6 bg-white rounded-lg shadow-inner'>
                <div className='space-y-4'>
                    {messages.map((message, index) => (
                        <ChatBox
                            key={message.id}
                            message={message}
                            onDelete={() => handleDeleteMessage(index)}
                            onEdit={(newText) => handleEditMessage(index, newText)}
                            onCopy={() => handleCopyMessage(message.text)}
                            onRegenerate={() => handleRegenerateMessage(index)}
                            onTogglePlay={() => handleTogglePlay(index)}
                            isPlaying={playingIndex === index}
                        />
                    ))}
                    {animatingMessageId && (
                        <ChatBox
                            message={{ text: animatingText, sender: 'assistant' }}
                            onDelete={() => { }}
                            onEdit={() => { }}
                            onCopy={() => { }}
                            onRegenerate={() => { }}
                            onTogglePlay={() => { }}
                            isPlaying={false}
                        />
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </ScrollArea>
            <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }} className='flex space-x-4'>
                <Input
                    type="text"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder="메시지를 입력해주세요"
                    className='flex-grow bg-white text-lg'
                    disabled={isGenerating}
                />
                <Button
                    type="submit"
                    className='bg-zinc-700 hover:bg-zinc-600 text-white px-6 py-2 text-lg'
                    disabled={isGenerating || isAnimating}
                >
                    전송
                </Button>
            </form>
            <Toaster />
        </div>
    );
}
