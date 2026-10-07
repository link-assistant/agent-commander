import json
from pathlib import Path
cases = [
 {'name':'Claude final usage supersedes repeated assistant snapshots','tool':'claude','events':[{'type':'assistant','message':{'id':'m1','usage':{'input_tokens':10,'output_tokens':1}}},{'type':'assistant','message':{'id':'m1','usage':{'input_tokens':10,'output_tokens':5}}},{'type':'result','subtype':'success','usage':{'input_tokens':12,'output_tokens':6,'cache_creation_input_tokens':3,'cache_read_input_tokens':4}}],'usage':{'inputTokens':12,'outputTokens':6,'cacheCreationTokens':3,'cacheReadTokens':4}},
 {'name':'Codex separates cached input from fresh input','tool':'codex','events':[{'type':'turn.completed','usage':{'input_tokens':100,'cached_input_tokens':80,'output_tokens':15,'reasoning_output_tokens':5}}],'usage':{'inputTokens':20,'outputTokens':15,'cacheReadTokens':80,'reasoningTokens':5}},
 {'name':'OpenCode native step tokens and cost','tool':'opencode','events':[{'type':'step_finish','sessionID':'native-session','part':{'type':'step-finish','reason':'stop','cost':0.012,'tokens':{'input':10,'output':3,'reasoning':2,'cache':{'read':4,'write':5}}}}],'usage':{'inputTokens':10,'outputTokens':3,'reasoningTokens':2,'cacheReadTokens':4,'cacheWriteTokens':5,'totalCost':0.012}},
 {'name':'Agent native step tokens remain compatible','tool':'agent','events':[{'type':'step_finish','part':{'cost':0.02,'tokens':{'input':8,'output':2,'cache':{'read':3,'write':4}}}}],'usage':{'inputTokens':8,'outputTokens':2,'cacheReadTokens':3,'cacheWriteTokens':4,'totalCost':0.02}},
 {'name':'Qwen final result totals do not double count assistant usage','tool':'qwen','events':[{'type':'assistant','message':{'usage':{'input_tokens':10,'output_tokens':2}}},{'type':'result','subtype':'success','usage':{'input_tokens':20,'output_tokens':4,'cache_read_input_tokens':5}}],'usage':{'inputTokens':20,'outputTokens':4,'cacheReadTokens':5,'totalTokens':29}},
 {'name':'Gemini native result statistics preserve model usage','tool':'gemini','events':[{'type':'result','status':'success','stats':{'models':{'gemini-2.5-pro':{'tokens':{'prompt':30,'candidates':8,'cached':10,'thoughts':2,'total':40}}}}}],'usage':{'inputTokens':30,'outputTokens':8,'cacheReadTokens':10,'reasoningTokens':2,'totalTokens':40}},
]
metadata = [
 {'name':'unfinished Codex turn','tool':'codex','events':[{'type':'thread.started','thread_id':'t'},{'type':'turn.started'}],'expected':{'success':False,'errorType':'incomplete_stream'}},
 {'name':'unfinished second Codex turn','tool':'codex','events':[{'type':'turn.completed'},{'type':'turn.started'}],'expected':{'success':False}},
 {'name':'failed Codex turn without error payload','tool':'codex','events':[{'type':'turn.failed','error':None}],'expected':{'success':False}},
 {'name':'unfinished Claude session','tool':'claude','events':[{'type':'system','subtype':'init'},{'type':'assistant','message':{'content':[{'text':'Working'}]}}],'expected':{'success':False,'errorType':'incomplete_stream'}},
 {'name':'unfinished Gemini session','tool':'gemini','events':[{'type':'init','session_id':'g'},{'type':'message','role':'assistant','content':'Working'}],'expected':{'success':False}},
 {'name':'completed Codex ignores quoted limit message','tool':'codex','events':[{'type':'turn.started'},{'type':'item.completed','item':{'type':'command_execution','aggregated_output':'Usage limit reached'}},{'type':'item.completed','item':{'type':'agent_message','text':'Done'}},{'type':'turn.completed'}],'expected':{'success':True,'limitReached':False,'resultSummary':'Done'}},
 {'name':'OpenCode native session and answer','tool':'opencode','events':[{'type':'text','sessionID':'s','part':{'type':'text','text':'Done'}},{'type':'step_finish','part':{'reason':'stop'}}],'expected':{'sessionId':'s','resultSummary':'Done','success':True}},
 {'name':'Gemini failed result','tool':'gemini','events':[{'type':'result','status':'error','error':{'message':'Quota exceeded'}}],'expected':{'success':False}},
 {'name':'nested Codex collaboration','tool':'codex','events':[{'type':'item.completed','item':{'type':'collab_tool_call','id':'worker1','status':'completed','name':'worker'}},{'type':'turn.completed'}],'expected':{'success':True},'subAgentId':'worker1'},
 {'name':'null error on successful result','tool':'qwen','events':[{'type':'result','subtype':'success','error':None}],'expected':{'success':True}},
 {'name':'OpenCode unfinished tool call','tool':'opencode','events':[{'type':'step_start'},{'type':'step_finish','part':{'reason':'tool-calls'}}],'expected':{'success':False}},
]
cases.append({'name':'Claude excludes subagent final totals','tool':'claude','events':[{'type':'result','subtype':'success','usage':{'input_tokens':12,'output_tokens':6}},{'type':'result','parent_tool_use_id':'worker','usage':{'input_tokens':999,'output_tokens':999}}],'usage':{'inputTokens':12,'outputTokens':6}})
metadata.extend([
 {'name':'Claude subagent errors stay diagnostic','tool':'claude','events':[{'type':'result','subtype':'success','result':'Main done','session_id':'main'},{'type':'result','parent_tool_use_id':'worker','subtype':'error_during_execution','is_error':True,'result':'Worker stopped'}],'expected':{'success':True,'resultSummary':'Main done','sessionId':'main'}},
 {'name':'Codex recovers a transient error before completing','tool':'codex','events':[{'type':'turn.started'},{'type':'error','message':'Retrying transport'},{'type':'turn.completed'}],'expected':{'success':True}},
 {'name':'error after completed Codex turn is a failure','tool':'codex','events':[{'type':'turn.completed'},{'type':'error','message':'Final failure'}],'expected':{'success':False}},
 {'name':'Claude native Agent call is recorded','tool':'claude','events':[{'type':'assistant','message':{'content':[{'type':'tool_use','name':'Agent','id':'worker2','input':{'description':'Review'}}]}},{'type':'result','subtype':'success','result':'Reviewed'}],'expected':{'success':True},'subAgentId':'worker2'},
])
cases.extend([
 {'name':'Codex nested cache and reasoning fields','tool':'codex','events':[{'type':'turn.completed','usage':{'input_tokens':100,'output_tokens':15,'input_tokens_details':{'cached_tokens':80,'cache_write_tokens':3},'output_tokens_details':{'reasoning_tokens':5}}}],'usage':{'inputTokens':20,'outputTokens':15,'cacheReadTokens':80,'cacheCreationTokens':3,'reasoningTokens':5}},
 {'name':'Qwen alternate field spellings','tool':'qwen','events':[{'type':'result','usage':{'promptTokens':10,'completionTokens':3,'cache_read_tokens':4,'cache_write_tokens':5,'thoughts_tokens':2}}],'usage':{'inputTokens':10,'outputTokens':3,'cacheReadTokens':4,'cacheCreationTokens':5,'reasoningTokens':2,'totalTokens':22}},
])
metadata.append({'name':'Gemini JSON object is a complete result','tool':'gemini','events':[{'response':'Done','stats':{'models':{}},'error':None}],'expected':{'success':True,'resultSummary':'Done'}})
Path('js/test/fixtures/hive-mind-parity.json').write_text(json.dumps({'usage':cases,'metadata':metadata},indent=2)+'\n')

Path('rust/tests/fixtures').mkdir(parents=True, exist_ok=True)
Path('rust/tests/fixtures/hive-mind-parity.json').write_text(Path('js/test/fixtures/hive-mind-parity.json').read_text())
