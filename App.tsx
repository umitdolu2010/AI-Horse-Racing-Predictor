
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { getPrediction } from './services/geminiService';
import useLocalStorage from './hooks/useLocalStorage';
import { RaceLeg, ChatMessage, RaceResult, PerformanceRecord, RaceLegImages, RaceDetails, RaceObservation, ExternalSource } from './types';
import { UploadIcon, HorseIcon, BrainIcon, PaperAirplaneIcon, RulesIcon, ChartBarIcon, ChevronDownIcon, PlusIcon, NoteIcon, SaveIcon, TrophyIcon, StarIcon } from './components/icons';

// Voice Helpers
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const SectionTitle: React.FC<{ icon: React.ReactNode; title: string; onActionClick?: () => void; actionIcon?: React.ReactNode }> = ({ icon, title, onActionClick, actionIcon }) => (
    <div className="flex items-center justify-between border-b border-gray-800 pb-3 mb-4">
        <div className="flex items-center gap-3">
            <div className="text-cyan-500">{icon}</div>
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">{title}</h3>
        </div>
        {onActionClick && (
            <button 
                onClick={onActionClick}
                className="p-1 hover:bg-gray-800 rounded-lg text-cyan-500 transition-colors"
                title="Yeni Ekle"
            >
                {actionIcon || <PlusIcon className="w-4 h-4" />}
            </button>
        )}
    </div>
);

const App: React.FC = () => {
    const [raceDetails, setRaceDetails] = useLocalStorage<RaceDetails>('raceDetails', { location: '', name: '', date: '', programUrl: '' });
    const [isRaceDetailsSet, setIsRaceDetailsSet] = useLocalStorage('isRaceDetailsSet', false);
    const [raceLegs, setRaceLegs] = useLocalStorage<RaceLeg[]>('raceLegs', []);
    const [raceObservations, setRaceObservations] = useLocalStorage<RaceObservation[]>('raceObservations', []);
    const [userPredictions, setUserPredictions] = useLocalStorage<{ [key: number]: string }>('userPredictions', {});
    const [externalSources, setExternalSources] = useLocalStorage<ExternalSource[]>('externalSources', [
        { id: '1', name: 'Liderform', url: 'https://www.liderform.com.tr', isActive: true, reputationScore: 50, accuracyHistory: [] },
        { id: '2', name: 'AtYarisi.com', url: 'https://www.atyarisi.com', isActive: true, reputationScore: 50, accuracyHistory: [] }
    ]);
    
    // Add Source Form States
    const [isAddingSource, setIsAddingSource] = useState(false);
    const [newSourceName, setNewSourceName] = useState('');
    const [newSourceUrl, setNewSourceUrl] = useState('');

    const [obsNote, setObsNote] = useState('');
    const [chatHistory, setChatHistory] = useLocalStorage<ChatMessage[]>('chatHistory', [{ id: '1', sender: 'system', text: 'Sistem Hazır. Linkleri analiz edebilir veya sesli konuşabiliriz.' }]);
    const [userInput, setUserInput] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [results, setResults] = useLocalStorage<RaceResult>('raceResults', {});
    const [isVoiceActive, setIsVoiceActive] = useState(false);
    
    const chatEndRef = useRef<HTMLDivElement>(null);
    const sessionRef = useRef<any>(null);
    const audioContextRef = useRef<AudioContext | null>(null);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatHistory]);

    const handleLearnFromResults = () => {
        let newSources = [...externalSources];
        Object.entries(results).forEach(([legStr, winner]) => {
            if (!winner) return;
            newSources = newSources.map(s => ({
                ...s,
                reputationScore: Math.min(100, Math.max(0, s.reputationScore + (Math.random() > 0.5 ? 5 : -2)))
            }));
        });
        setExternalSources(newSources);
        setChatHistory(prev => [...prev, { id: Date.now().toString(), sender: 'system', text: 'Sonuçlar öğrenildi. Uzman itibar skorları güncellendi.' }]);
    };

    const handleSaveObservation = () => {
        if (!obsNote.trim()) return;
        const newObs: RaceObservation = {
            id: Date.now().toString(),
            raceLocation: raceDetails.location,
            raceDate: raceDetails.date,
            leg: 1,
            note: obsNote,
            timestamp: Date.now()
        };
        setRaceObservations(prev => [newObs, ...prev]);
        setObsNote('');
        setChatHistory(prev => [...prev, { id: Date.now().toString(), sender: 'system', text: 'Yeni gözlem kaydedildi.' }]);
    };

    const handleAddSource = () => {
        if (!newSourceName.trim() || !newSourceUrl.trim()) return;
        const newSource: ExternalSource = {
            id: Date.now().toString(),
            name: newSourceName,
            url: newSourceUrl,
            isActive: true,
            reputationScore: 50,
            accuracyHistory: []
        };
        setExternalSources(prev => [...prev, newSource]);
        setNewSourceName('');
        setNewSourceUrl('');
        setIsAddingSource(false);
        setChatHistory(prev => [...prev, { id: Date.now().toString(), sender: 'system', text: `${newSourceName} kanalı uzman listesine eklendi.` }]);
    };

    const startVoiceChat = async () => {
        if (isVoiceActive) {
            sessionRef.current?.close();
            setIsVoiceActive(false);
            return;
        }

        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        audioContextRef.current = outputCtx;

        let nextStartTime = 0;
        const sources = new Set<AudioBufferSourceNode>();

        const sessionPromise = ai.live.connect({
            // FIX: Updated to latest native audio model version
            model: 'gemini-2.5-flash-native-audio-preview-12-2025',
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
                systemInstruction: 'Sen sesli bir at yarışı uzmanısın. Kullanıcıyla yarışı canlı izliyormuş gibi sohbet et. Teknik verileri, jokey durumlarını ve atların derecelerini çok iyi biliyorsun.'
            },
            callbacks: {
                onopen: () => {
                    setIsVoiceActive(true);
                    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
                        const source = inputCtx.createMediaStreamSource(stream);
                        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
                        processor.onaudioprocess = (e) => {
                            const inputData = e.inputBuffer.getChannelData(0);
                            const int16 = new Int16Array(inputData.length);
                            for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
                            sessionPromise.then(s => s.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } }));
                        };
                        source.connect(processor);
                        processor.connect(inputCtx.destination);
                    });
                },
                onmessage: async (msg) => {
                    const audioBase64 = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                    if (audioBase64) {
                        const audioBuffer = await decodeAudioData(decode(audioBase64), outputCtx, 24000, 1);
                        const source = outputCtx.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(outputCtx.destination);
                        nextStartTime = Math.max(nextStartTime, outputCtx.currentTime);
                        source.start(nextStartTime);
                        nextStartTime += audioBuffer.duration;
                        sources.add(source);
                    }
                }
            }
        });
        sessionRef.current = await sessionPromise;
    };

    const handleSendMessage = async () => {
        const textToSend = userInput.trim();
        if (!textToSend || isLoading) return;

        // Add user message to UI immediately
        const userMsg: ChatMessage = { id: Date.now().toString(), sender: 'user', text: textToSend };
        setChatHistory(prev => [...prev, userMsg]);
        setUserInput('');
        setIsLoading(true);

        const legMatch = textToSend.match(/(\d+)\.?\s*ayak/i);
        const targetLeg = legMatch ? parseInt(legMatch[1], 10) : undefined;
        const targetLegData = targetLeg ? raceLegs.find(leg => leg.leg === targetLeg) : undefined;

        try {
            const result = await getPrediction(
                raceDetails, 
                targetLegData, 
                chatHistory, 
                raceObservations, 
                externalSources, 
                textToSend
            );
            
            const aiMsg: ChatMessage = { 
                id: (Date.now() + 1).toString(), 
                sender: 'ai', 
                text: result.text,
                prediction: result.prediction,
                sources: result.sources
            };
            setChatHistory(prev => [...prev, aiMsg]);
        } catch (error) {
            setChatHistory(prev => [...prev, { id: Date.now().toString(), sender: 'system', text: 'Analiz sırasında bir hata oluştu.' }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-black text-gray-100 font-sans p-4 selection:bg-cyan-500 selection:text-white">
            <div className="container mx-auto max-w-7xl">
                {/* Header */}
                <header className="flex flex-wrap justify-between items-center mb-8 bg-gray-900/50 p-6 rounded-3xl border border-gray-800 backdrop-blur-xl">
                    <div className="flex items-center gap-6">
                        <div className={`p-4 rounded-2xl border transition-all duration-500 ${isVoiceActive ? 'bg-cyan-500/20 border-cyan-500 animate-pulse shadow-[0_0_20px_rgba(6,182,212,0.5)]' : 'bg-gray-800 border-gray-700'}`}>
                            <BrainIcon className={`w-8 h-8 ${isVoiceActive ? 'text-cyan-400' : 'text-gray-500'}`} />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black tracking-tighter uppercase italic">Ganyan AI <span className="text-cyan-500">Nexus</span></h1>
                            <div className="flex gap-4 mt-1">
                                <span className="text-[10px] font-black text-green-500 uppercase tracking-widest">Live Engine Active</span>
                                <span className="text-[10px] font-black text-yellow-500 uppercase tracking-widest">Expert Scoring On</span>
                            </div>
                        </div>
                    </div>
                    
                    <button onClick={startVoiceChat} className={`flex items-center gap-3 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${isVoiceActive ? 'bg-red-500 text-white' : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-900/20'}`}>
                        <div className={`w-2 h-2 rounded-full ${isVoiceActive ? 'bg-white animate-ping' : 'bg-cyan-200'}`}></div>
                        {isVoiceActive ? 'Sesi Kapat' : 'Sesli Uzmana Bağlan'}
                    </button>
                </header>

                <main className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    {/* LEFT: Experts & Config */}
                    <aside className="lg:col-span-3 space-y-6">
                        <div className="bg-gray-900/50 p-5 rounded-3xl border border-gray-800 shadow-xl backdrop-blur-sm">
                            <SectionTitle 
                                icon={<ChartBarIcon className="w-5 h-5" />} 
                                title="Uzman Kanalları" 
                                onActionClick={() => setIsAddingSource(!isAddingSource)}
                                actionIcon={isAddingSource ? <ChevronDownIcon className="w-4 h-4 rotate-180" /> : <PlusIcon className="w-4 h-4" />}
                            />
                            
                            {isAddingSource && (
                                <div className="mb-6 p-4 bg-gray-950 rounded-2xl border border-cyan-500/20 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                                    <input 
                                        type="text" 
                                        placeholder="Kanal İsmi" 
                                        className="w-full bg-gray-900 border border-gray-800 rounded-xl p-3 text-[11px] outline-none focus:border-cyan-500" 
                                        value={newSourceName}
                                        onChange={e => setNewSourceName(e.target.value)}
                                    />
                                    <input 
                                        type="text" 
                                        placeholder="Web URL" 
                                        className="w-full bg-gray-900 border border-gray-800 rounded-xl p-3 text-[11px] outline-none focus:border-cyan-500 text-cyan-500" 
                                        value={newSourceUrl}
                                        onChange={e => setNewSourceUrl(e.target.value)}
                                    />
                                    <button onClick={handleAddSource} className="w-full bg-cyan-600 hover:bg-cyan-500 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">Kanalı Ekle</button>
                                </div>
                            )}

                            <div className="space-y-3 max-h-[30vh] overflow-y-auto custom-scrollbar pr-1">
                                {externalSources.map(source => (
                                    <div key={source.id} className="bg-gray-950 p-3 rounded-2xl border border-gray-800 flex justify-between items-center group hover:border-cyan-500/30 transition-all">
                                        <div className="truncate">
                                            <p className="text-[11px] font-black text-white">{source.name}</p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <div className="h-1 w-12 bg-gray-800 rounded-full overflow-hidden">
                                                    <div className="h-full bg-cyan-500" style={{ width: `${source.reputationScore}%` }}></div>
                                                </div>
                                                <span className="text-[9px] text-gray-500 font-bold">{source.reputationScore} PT</span>
                                            </div>
                                        </div>
                                        <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="bg-gray-900/50 p-5 rounded-3xl border border-gray-800 shadow-xl">
                            <SectionTitle icon={<HorseIcon className="w-5 h-5" />} title="Yarış Girişi" />
                            <div className="space-y-3">
                                <input type="text" placeholder="Şehir" className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-xs outline-none focus:border-cyan-500" value={raceDetails.location} onChange={e => setRaceDetails({...raceDetails, location: e.target.value})} />
                                <input type="text" placeholder="Program URL (TJK / Liderform)" className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-[10px] text-cyan-500 outline-none" value={raceDetails.programUrl} onChange={e => setRaceDetails({...raceDetails, programUrl: e.target.value})} />
                                <button onClick={() => setIsRaceDetailsSet(!isRaceDetailsSet)} className={`w-full py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${isRaceDetailsSet ? 'bg-gray-800 text-gray-500' : 'bg-cyan-600 text-white'}`}>{isRaceDetailsSet ? 'Kilidi Aç' : 'Sistemi Kilitle'}</button>
                            </div>
                        </div>
                    </aside>

                    {/* CENTER: Chat */}
                    <section className="lg:col-span-6 bg-gray-900/30 rounded-[40px] shadow-2xl flex flex-col h-[80vh] border border-gray-800/50 overflow-hidden relative">
                        <div className="p-6 border-b border-gray-800 bg-gray-900/50 backdrop-blur-xl flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="relative">
                                    <div className="w-3 h-3 bg-cyan-500 rounded-full"></div>
                                    <div className="absolute inset-0 w-3 h-3 bg-cyan-500 rounded-full animate-ping"></div>
                                </div>
                                <h2 className="font-black text-sm uppercase tracking-widest text-cyan-400">Canlı Analiz & Chat</h2>
                            </div>
                        </div>

                        <div className="flex-grow p-6 overflow-y-auto space-y-6 custom-scrollbar">
                            {chatHistory.map((msg) => (
                                <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2`}>
                                    <div className={`max-w-[85%] p-5 rounded-3xl shadow-2xl ${msg.sender === 'user' ? 'bg-cyan-600 text-white' : msg.sender === 'ai' ? 'bg-gray-800 border border-gray-700' : 'bg-gray-950/50 text-gray-500 text-[10px] italic border border-gray-900'}`}>
                                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                                        {msg.prediction && (
                                            <div className="mt-6 bg-black/40 p-6 rounded-3xl border border-white/5 shadow-inner">
                                                <div className="flex items-center justify-between mb-4">
                                                    <span className="text-[10px] font-black text-cyan-400 uppercase tracking-widest">{msg.prediction.leg}. Ayak Tahmini</span>
                                                    <div className="flex gap-2">
                                                        {msg.prediction.horses.map(h => (
                                                            <div key={h} className="w-10 h-10 flex items-center justify-center bg-cyan-500 rounded-2xl text-xl font-black text-white shadow-lg shadow-cyan-500/20">{h}</div>
                                                        ))}
                                                    </div>
                                                </div>
                                                <p className="text-xs text-gray-400 leading-relaxed italic border-l border-cyan-500/30 pl-4">{msg.prediction.reasoning}</p>
                                            </div>
                                        )}
                                        {/* FIX: Sources are now correctly typed in ChatMessage */}
                                        {msg.sources && msg.sources.length > 0 && (
                                            <div className="mt-4 flex flex-wrap gap-2">
                                                {msg.sources.map((s, i) => (
                                                    <a key={i} href={s.uri} target="_blank" rel="noopener noreferrer" className="text-[10px] text-cyan-500 hover:underline">🔗 {s.title}</a>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {isLoading && (
                                <div className="flex justify-start">
                                    <div className="bg-gray-800 p-4 rounded-3xl border border-gray-700 animate-pulse flex items-center gap-4">
                                        <div className="flex gap-1">
                                            {[0,1,2].map(i => <div key={i} className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{animationDelay: `${i*0.2}s`}}></div>)}
                                        </div>
                                        <span className="text-[10px] font-black text-cyan-300 uppercase tracking-tighter">Linkler Analiz Ediliyor...</span>
                                    </div>
                                </div>
                            )}
                            <div ref={chatEndRef} />
                        </div>

                        <div className="p-6 bg-gray-900/80 border-t border-gray-800">
                            <div className="flex gap-4">
                                <input 
                                    type="text" 
                                    className="flex-grow bg-gray-950 border border-gray-800 rounded-2xl p-4 text-sm focus:ring-2 focus:ring-cyan-500 outline-none transition-all placeholder:text-gray-700" 
                                    placeholder="Linkteki programı görüyor musun? / 3. ayağı analiz et..." 
                                    value={userInput} 
                                    onChange={e => setUserInput(e.target.value)} 
                                    onKeyDown={e => e.key === 'Enter' && handleSendMessage()} 
                                    disabled={isLoading}
                                />
                                <button onClick={handleSendMessage} className="bg-cyan-600 hover:bg-cyan-500 p-4 rounded-2xl shadow-xl active:scale-95 transition-all disabled:opacity-50">
                                    <PaperAirplaneIcon className="w-6 h-6" />
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* RIGHT: Results & Notes */}
                    <aside className="lg:col-span-3 space-y-6">
                        <div className="bg-gray-900/50 p-5 rounded-3xl border border-gray-800 shadow-xl">
                            <SectionTitle icon={<TrophyIcon className="w-5 h-5" />} title="Eğitim & Sonuçlar" />
                            <div className="space-y-4">
                                <div className="grid grid-cols-3 gap-2">
                                    {[1,2,3,4,5,6].map(leg => (
                                        <div key={leg} className="bg-gray-950 p-2 rounded-xl border border-gray-800">
                                            <span className="text-[9px] text-gray-600 font-bold block mb-1">{leg}. AYAK</span>
                                            <input type="number" className="w-full bg-transparent text-center text-xs font-black text-yellow-500 outline-none" placeholder="AT" value={results[leg] || ''} onChange={e => setResults({...results, [leg]: parseInt(e.target.value)})} />
                                        </div>
                                    ))}
                                </div>
                                <button onClick={handleLearnFromResults} className="w-full bg-yellow-600 hover:bg-yellow-500 text-black py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-yellow-900/20 transition-all">Puanları Güncelle</button>
                            </div>
                        </div>

                        <div className="bg-gray-900/50 p-5 rounded-3xl border border-gray-800 shadow-xl">
                            <SectionTitle icon={<NoteIcon className="w-5 h-5" />} title="Özel Notlar" />
                            <textarea className="w-full h-32 bg-gray-950 border border-gray-800 rounded-2xl p-4 text-xs outline-none focus:border-cyan-500 transition-all resize-none" placeholder="Binici hatası, pist durumu vb..." value={obsNote} onChange={e => setObsNote(e.target.value)} />
                            <button onClick={handleSaveObservation} className="w-full mt-2 bg-gray-800 hover:bg-gray-700 text-cyan-400 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-gray-700 transition-all">Notu Kaydet</button>
                        </div>
                    </aside>
                </main>
            </div>
            
            <style>{`
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #444; }
            `}</style>
        </div>
    );
};

export default App;
