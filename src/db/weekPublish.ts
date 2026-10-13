import { arrayUnion, doc, getDoc, writeBatch } from './guard';
import { Notice, WeekPub } from '../types';
import { firebaseActive, dbInstance } from './core';
import { NoticeFile, noticeFileData } from './notices';
import { weekPlanId } from './weekPlans';

// PROGRAMAÇÃO › PUBLICAR (Fase 7D): o PDF da semana vai para o Quadro de Avisos (Atenção, fixado, só técnicos, até o
// domingo) e a revisão anterior é apagada do quadro (resposta do usuário: "nova revisão ao publicar apaga o aviso
// anterior"). Num pacote só: aviso novo + PDF, apaga o aviso e o PDF anteriores, e a semana guarda a publicação.

export interface WeekPublish {
  key: { unit: string; company: string; weekStart: string };
  notice: Notice; // já com o id novo
  file: NoticeFile;
  pub: WeekPub;
  prev?: WeekPub | null; // a publicação anterior (o aviso dela sai do quadro)
  by: string;
}

export async function dbPublishWeek(p: WeekPublish): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const db = dbInstance;
  const now = new Date().toISOString();
  // o aviso anterior pode já ter sido apagado à mão no Quadro de Avisos
  const prevRef = p.prev ? doc(db, 'notices', p.prev.noticeId) : null;
  const prevExists = prevRef ? (await getDoc(prevRef)).exists() : false;
  const batch = writeBatch(db);
  const { id, ...data } = p.notice;
  batch.set(doc(db, 'notices', id), JSON.parse(JSON.stringify(data)));
  batch.set(doc(db, 'noticeFiles', id), noticeFileData(p.file));
  if (prevRef && prevExists) {
    batch.delete(prevRef);
    batch.delete(doc(db, 'noticeFiles', p.prev!.noticeId));
  }
  batch.set(
    doc(db, 'weekPlans', weekPlanId(p.key.unit, p.key.company, p.key.weekStart)),
    {
      ...p.key,
      updatedAt: now,
      updatedBy: p.by,
      pubs: arrayUnion(p.pub),
      log: arrayUnion({ at: now, by: p.by, text: `Publicou a Rev. ${p.pub.rev} (PDF no Quadro de Avisos)${p.prev ? `; o aviso da Rev. ${p.prev.rev} saiu do quadro` : ''}` })
    },
    { merge: true }
  );
  await batch.commit();
}
