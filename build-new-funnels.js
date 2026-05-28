const { PrismaClient } = require('/var/www/flows.fineko.space/platform/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {

  // ── 1. content-ai-bg-pro (FLUX 1.1 Pro Ultra 2K) ────────────────────────
  {
    const botId = '058f48d6-4e67-4c17-af0e-ff7e586a179b';
    const nodes = [
      { id: 'start_1', type: 'start', position: { x: 80, y: 80 },
        data: { label: 'Webhook Trigger', trigger: 'webhook' } },
      { id: 'node_pro_fal', type: 'httpRequest', position: { x: 400, y: 200 },
        data: {
          label: 'FLUX 1.1 Pro Ultra 2K',
          method: 'POST',
          url: 'https://fal.run/fal-ai/flux-pro/v1.1-ultra',
          headers: { Authorization: 'Key {{keys.FAL_AI_KEY}}' },
          body: '{"prompt":"{{context.prompt}}, 8K ultra-sharp, cinematic color grading, volumetric lighting","negative_prompt":"watermark, blurry, extra limbs, deformed, cheap look, AI artifacts, overexposed","aspect_ratio":"{{context.aspectRatio}}","output_format":"jpeg","raw":false}',
          outputVar: 'aiImageUrl',
          responseField: 'images.0.url',
          description: 'FLUX 1.1 Pro Ultra: 2K photorealism ~$0.06/img. Для преміум контенту.'
        }
      },
      { id: 'node_pro_slide', type: 'httpRequest', position: { x: 400, y: 380 },
        data: {
          label: 'Рендер slide-builder',
          method: 'POST',
          url: 'https://slides.flows.fineko.space/render/story',
          body: '{"params":{"template":"photo-text","width":{{context.width}},"height":{{context.height}},"photoUrl":"{{context.aiImageUrl}}","title":"{{context.title}}","subtitle":"{{context.subtitle}}","extra":"{{context.extra}}","bgColor":"{{context.bgColor}}","accent":"{{context.accent}}","fgColor":"{{context.fgColor}}"}}',
          outputVar: 'finalImageBase64',
          responseField: 'result.imageBase64'
        }
      },
      { id: 'node_pro_vision', type: 'js', position: { x: 400, y: 540 },
        data: {
          label: 'Vision Check',
          code: 'const img=context.finalImageBase64,r=context.visionRetryCount||0,ok=typeof img==="string"&&img.length>20000;return{visionOk:ok,visionRetryCount:ok?r:r+1};'
        }
      },
      { id: 'node_pro_cond', type: 'condition', position: { x: 400, y: 680 },
        data: {
          label: 'Image OK?',
          condition: 'context.visionOk === true || context.visionRetryCount >= 2',
          trueLabel: 'OK → callback', falseLabel: 'Retry'
        }
      },
      { id: 'node_pro_callback', type: 'httpRequest', position: { x: 700, y: 680 },
        data: {
          label: 'Callback',
          method: 'POST',
          url: '{{context.callbackUrl}}',
          body: '{"postId":"{{context.postId}}","status":"success","mediaType":"image","imageBase64":"{{context.finalImageBase64}}","contentType":"image/png"}',
          outputVar: 'callbackResult'
        }
      }
    ];
    const edges = [
      { id: 'e1', source: 'start_1', target: 'node_pro_fal' },
      { id: 'e2', source: 'node_pro_fal', target: 'node_pro_slide' },
      { id: 'e3', source: 'node_pro_slide', target: 'node_pro_vision' },
      { id: 'e4', source: 'node_pro_vision', target: 'node_pro_cond' },
      { id: 'e5', source: 'node_pro_cond', target: 'node_pro_callback', sourceHandle: 'true' },
      { id: 'e6', source: 'node_pro_cond', target: 'node_pro_fal', sourceHandle: 'false' }
    ];
    await prisma.flowDefinition.update({ where: { botId }, data: { nodes, edges } });
    console.log('content-ai-bg-pro built');
  }

  // ── 2. content-ideogram (Ideogram V3 — текст у зображенні) ──────────────
  {
    const botId = '16c44a5b-8c82-4755-b219-854b51191d26';
    const nodes = [
      { id: 'start_1', type: 'start', position: { x: 80, y: 80 },
        data: { label: 'Webhook Trigger', trigger: 'webhook' } },
      { id: 'node_idg_fal', type: 'httpRequest', position: { x: 400, y: 200 },
        data: {
          label: 'Ideogram V3 — типографіка',
          method: 'POST',
          url: 'https://fal.run/fal-ai/ideogram/v3',
          headers: { Authorization: 'Key {{keys.FAL_AI_KEY}}' },
          body: '{"prompt":"{{context.prompt}}","aspect_ratio":"{{context.aspect_ratio}}","style_type":"{{context.style_type}}","negative_prompt":"ugly, blurry, low quality, watermark, deformed"}',
          outputVar: 'aiImageUrl',
          responseField: 'images.0.url',
          description: 'Ideogram V3: найкраща AI-типографіка. Для цитат, статистики, мотиваційних постів де текст є частиною картинки. aspect_ratio: ASPECT_9_16 | ASPECT_1_1 | ASPECT_4_5. style_type: DESIGN | REALISTIC | ANIME | GENERAL'
        }
      },
      { id: 'node_idg_callback', type: 'httpRequest', position: { x: 400, y: 380 },
        data: {
          label: 'Callback',
          method: 'POST',
          url: '{{context.callbackUrl}}',
          body: '{"postId":"{{context.postId}}","status":"success","mediaType":"imageUrl","imageUrl":"{{context.aiImageUrl}}"}',
          outputVar: 'callbackResult'
        }
      }
    ];
    const edges = [
      { id: 'e1', source: 'start_1', target: 'node_idg_fal' },
      { id: 'e2', source: 'node_idg_fal', target: 'node_idg_callback' }
    ];
    await prisma.flowDefinition.update({ where: { botId }, data: { nodes, edges } });
    console.log('content-ideogram built');
  }

  // ── 3. content-recraft (Recraft V4.1 — брендовий дизайн) ────────────────
  {
    const botId = '96ba01dc-bf2c-480a-9daa-e34550dc51f7';
    const nodes = [
      { id: 'start_1', type: 'start', position: { x: 80, y: 80 },
        data: { label: 'Webhook Trigger', trigger: 'webhook' } },
      { id: 'node_rcr_fal', type: 'httpRequest', position: { x: 400, y: 200 },
        data: {
          label: 'Recraft V4.1 — дизайн',
          method: 'POST',
          url: 'https://fal.run/fal-ai/recraft-v3',
          headers: { Authorization: 'Key {{keys.FAL_AI_KEY}}' },
          body: '{"prompt":"{{context.prompt}}","style":"{{context.style}}","image_size":"{{context.image_size}}"}',
          outputVar: 'aiImageUrl',
          responseField: 'images.0.url',
          description: 'Recraft V4.1: брендовий дизайн. style: realistic_image | digital_illustration | vector_illustration | icon. image_size: square_hd | portrait_9_16 | landscape_16_9. Для інфографіки та рекламних матеріалів.'
        }
      },
      { id: 'node_rcr_callback', type: 'httpRequest', position: { x: 400, y: 380 },
        data: {
          label: 'Callback',
          method: 'POST',
          url: '{{context.callbackUrl}}',
          body: '{"postId":"{{context.postId}}","status":"success","mediaType":"imageUrl","imageUrl":"{{context.aiImageUrl}}"}',
          outputVar: 'callbackResult'
        }
      }
    ];
    const edges = [
      { id: 'e1', source: 'start_1', target: 'node_rcr_fal' },
      { id: 'e2', source: 'node_rcr_fal', target: 'node_rcr_callback' }
    ];
    await prisma.flowDefinition.update({ where: { botId }, data: { nodes, edges } });
    console.log('content-recraft built');
  }

  // ── 4. content-manager: NotebookLM KB routing ────────────────────────────
  {
    const botId = 'bd48bae3-d35b-45f9-bcdd-3e74884b61bf';
    const flow = await prisma.flowDefinition.findUnique({ where: { botId } });

    const newNodes = [
      { id: 'node_kb_cond', type: 'condition', position: { x: -540, y: 1020 },
        data: {
          label: 'Is query_kb?',
          condition: "context.actionType === 'query_kb'",
          trueLabel: 'Пошук у БЗ', falseLabel: 'Нічого → агент'
        }
      },
      { id: 'node_kb_request', type: 'httpRequest', position: { x: -800, y: 1220 },
        data: {
          label: 'NotebookLM — семантичний пошук',
          method: 'POST',
          url: 'http://localhost:4200/notebooks/{{context.kbNotebookId}}/query',
          body: '{"question":"{{context.kbQuestion}}","language":"uk"}',
          outputVar: 'kbResponse',
          responseField: 'answer',
          description: 'Semantic RAG search through NotebookLM microservice (port 4200). Needs notebooklm-py auth.'
        }
      },
      { id: 'node_kb_after', type: 'js', position: { x: -800, y: 1400 },
        data: {
          label: 'Результат KB → агент',
          code: 'const r=context.kbResponse;return{actionResult:"База знань:\\n"+(typeof r==="string"?r:JSON.stringify(r)),actionType:null,actionFunnel:null,agentAction:null,kbQuestion:null,kbNotebookId:null};'
        }
      }
    ];

    const updatedNodes = [...flow.nodes, ...newNodes];

    // save_plan_cond [false] → agent  ➜  save_plan_cond [false] → kb_cond
    const updatedEdges = flow.edges.map(e =>
      e.id === 'edge_save_plan_false' ? { ...e, target: 'node_kb_cond' } : e
    );
    updatedEdges.push(
      { id: 'edge_kb_true',  source: 'node_kb_cond',    target: 'node_kb_request',       sourceHandle: 'true' },
      { id: 'edge_kb_false', source: 'node_kb_cond',    target: 'node_1779938202837',     sourceHandle: 'false' },
      { id: 'edge_kb_resp',  source: 'node_kb_request', target: 'node_kb_after' },
      { id: 'edge_kb_loop',  source: 'node_kb_after',   target: 'node_1779938202837' }
    );

    await prisma.flowDefinition.update({
      where: { botId },
      data: { nodes: updatedNodes, edges: updatedEdges }
    });
    console.log('content-manager KB routing added');
  }

  console.log('ALL DONE');
}

main()
  .catch(e => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
