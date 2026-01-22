
import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";
import { RaceLeg, PerformanceRecord, ChatMessage, RaceLegImages, RaceDetails, RaceObservation, ExternalSource } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

function fileToGenerativePart(base64: string, mimeType: string) {
  return {
    inlineData: {
      data: base64,
      mimeType,
    },
  };
}

function observationsToString(observations: RaceObservation[]): string {
    if (observations.length === 0) return "Henüz kaydedilmiş kullanıcı gözlemi yok.";
    return observations
        .sort((a, b) => b.timestamp - a.timestamp)
        .map(obs => 
        `[GÖZLEM - AYAK: ${obs.leg}] "${obs.note}"`
    ).join('\n');
}

export const getPrediction = async (
    raceDetails: RaceDetails,
    targetLegData: RaceLeg | undefined,
    chatHistory: ChatMessage[],
    raceObservations: RaceObservation[],
    externalSources: ExternalSource[],
    userQuery: string
): Promise<{ text: string, prediction?: { leg: number, horses: number[], reasoning: string }, sources?: Array<{title: string, uri: string}> }> => {
    
    const model = 'gemini-3-pro-preview';
    
    const specificLink = targetLegData?.link ? `BU AYAK ÖZEL LİNKİ: ${targetLegData.link}` : '';
    const generalLink = raceDetails.programUrl ? `GÜNLÜK GENEL PROGRAM LİNKİ: ${raceDetails.programUrl}` : '';
    
    const activeSources = externalSources
        .filter(s => s.isActive)
        .map(s => `${s.name} (Puan: ${s.reputationScore}, URL: ${s.url})`)
        .join('\n');

    const recentHistory = chatHistory.slice(-5).map(m => `${m.sender}: ${m.text}`).join('\n');

    const prompt = `
        Sen profesyonel bir Ganyan Stratejistisin. Kullanıcıyla canlı bir yarış sohbeti yapıyorsun.
        
        **KONTROL ETMEN GEREKEN VERİLER:**
        1. **LİNKLER (KRİTİK):** Kullanıcının verdiği şu linkleri ziyaret et ve içeriği analiz et:
           ${generalLink}
           ${specificLink}
           Ayrıca şu uzman kanallarına da göz atabilirsin:
           ${activeSources}
        
        2. **GÖZLEMLER:** Kullanıcının geçmiş notları:
           ${observationsToString(raceObservations)}

        3. **MEVCUT DURUM:** 
           Yer: ${raceDetails.location || 'Belirtilmedi'}
           Soru: "${userQuery}"

        **TALİMATLAR:**
        - Eğer kullanıcı belirli bir ayak için tahmin istiyorsa (örn: "3. ayağı analiz et"), yanıtında mutlaka at numaraları ve teknik gerekçeler (derece, mesafe, jokey) olsun.
        - Eğer kullanıcı genel bir soru soruyorsa (örn: "Linkteki programı görüyor musun?"), nazikçe onayla ve gördüğün detaylardan (koşu sayısı, at isimleri vb.) bahset ki kullanıcı linki okuduğunu anlasın.
        - Yanıtın samimi, profesyonel ve veriye dayalı olsun.

        **YANIT FORMATI (JSON):**
        Yanıtın MUTLAKA şu JSON yapısında olmalı:
        {
          "text": "Kullanıcıya vereceğin genel cevap mesajı...",
          "prediction": {
            "leg": 1, 
            "horses": [at_numaralari],
            "reasoning": "Tahmin varsa teknik gerekçesi, yoksa boş bırakılabilir."
          }
        }
        (Eğer bir tahmin yapmıyorsan, prediction alanını null veya boş bırakabilirsin.)
    `;

    const contents = [{ text: prompt }];

    // Add images if targeting a specific leg
    if (targetLegData?.images) {
        const imageOrder: (keyof RaceLegImages)[] = ['raceInfo', 'horseComparison', 'jockeyComparison', 'ownerComparison', 'trainerComparison', 'detailedHorseComparison', 'trainingInfo'];
        for (const key of imageOrder) {
            const base64Image = targetLegData.images[key];
            if (base64Image) {
                const [mimeTypePart, base64Part] = base64Image.split(';base64,');
                const mimeType = mimeTypePart.split(':')[1];
                contents.push(fileToGenerativePart(base64Part, mimeType) as any);
            }
        }
    }

    try {
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: model,
            contents: { parts: contents },
            config: {
                tools: [{ googleSearch: {} }],
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        text: { type: Type.STRING },
                        prediction: {
                            type: Type.OBJECT,
                            properties: {
                                leg: { type: Type.NUMBER },
                                horses: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                                reasoning: { type: Type.STRING }
                            }
                        }
                    },
                    required: ["text"]
                }
            }
        });

        const parsedResponse = JSON.parse(response.text);
        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
        const sources = groundingChunks?.map((chunk: any) => ({
            title: chunk.web?.title || 'Analiz Kaynağı',
            uri: chunk.web?.uri || ''
        })).filter((s: any) => s.uri !== '');

        return { 
            text: parsedResponse.text, 
            prediction: parsedResponse.prediction?.horses?.length > 0 ? parsedResponse.prediction : undefined,
            sources 
        };
    } catch (error) {
        console.error("Gemini Error:", error);
        return { text: "Üzgünüm, şu an linkleri veya verileri analiz ederken bir sorun yaşadım. Lütfen linklerin doğruluğunu kontrol et veya tekrar dene." };
    }
};
