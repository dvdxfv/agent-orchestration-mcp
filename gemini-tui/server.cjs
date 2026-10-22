const {createInterface}=require('node:readline');
const {call}=require('./client.cjs');
const str={type:'string',minLength:1};
const schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const tools=[
 {name:'get_session',description:'Read the actual visible Gemini TUI host identity and bounded terminal output. Does not start Gemini, move focus, or prove completion.',inputSchema:schema({max_chars:{type:'integer',minimum:0,maximum:20000,default:6000}}),annotations:{readOnlyHint:true}},
 {name:'send_message',description:'Send one line to the same native Gemini TUI through ConPTY, without mouse/keyboard injection or focus switching. Check the TUI is at an empty prompt first. Do not race human typing or send prompts into approval menus. A delivery acknowledgement is not model completion.',inputSchema:schema({session_id:str,text:{...str,maxLength:16000}},['session_id','text'])},
 {name:'send_key',description:'Send a named key directly to the visible TUI. Use only after inspecting the current menu. Enter may approve a tool: retain task authorization boundaries. interrupt sends Ctrl+C.',inputSchema:schema({session_id:str,key:{type:'string',enum:['enter','down','up','escape','interrupt']}},['session_id','key'])},
 {name:'close_session',description:'Send /quit to an idle Gemini prompt. Stops the visible Gemini host when Gemini exits; never force-kills other processes. Do not call while a menu or partial user input is active.',inputSchema:schema({session_id:str},['session_id'])}
];
const write=x=>process.stdout.write(JSON.stringify(x)+'\n');
let initialized=false;
async function handle(m){
 if(m.id===undefined)return;
 const reply=result=>write({jsonrpc:'2.0',id:m.id,result});
 try{
  if(m.method==='initialize'){initialized=true;return reply({protocolVersion:['2025-11-25','2025-06-18','2025-03-26','2024-11-05'].includes(m.params?.protocolVersion)?m.params.protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'gemini-tui',version:'0.1.0'},instructions:'Connects only to the user-visible native Gemini TUI. Never silently start headless. Inspect state before input; serialize with human typing. No remote start or auto-approval. MCP disconnect leaves the explicitly opened visible terminal under user control.'});}
  if(m.method==='ping')return reply({});
  if(!initialized)throw new Error('initialize required');
  if(m.method==='tools/list')return reply({tools});
  if(m.method!=='tools/call')return write({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}});
  if(!tools.some(t=>t.name===m.params?.name))throw new Error('Unknown tool');
  reply({content:[{type:'text',text:JSON.stringify(await call(m.params.name,m.params.arguments))}],isError:false});
 }catch(e){if(m.method==='tools/call')reply({content:[{type:'text',text:e.message}],isError:true});else write({jsonrpc:'2.0',id:m.id,error:{code:-32602,message:e.message}});}
}
let queue=Promise.resolve();
createInterface({input:process.stdin,crlfDelay:Infinity}).on('line',line=>{
 let m;try{m=JSON.parse(line);}catch{write({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});return;}
 queue=queue.then(()=>handle(m)).catch(e=>process.stderr.write(e.message+'\n'));
});
