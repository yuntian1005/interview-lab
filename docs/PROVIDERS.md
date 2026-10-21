# 服务接入

默认 DEMO_MODE=true 使用本地规则生成问题与评分。配置自己的服务后改为 false 并重启。

Dify 主面试使用 chat-messages 接口，输入变量：resume_text、jd_text、job_level、job_role、interview_duration、difficulty、question_count、security_instruction。应用应接受这些文本变量，不要求仅控制台可用的必填文件变量。

多轮复用 conversation_id。简历、岗位推荐和复盘可分别设置 Key。Coze prepare/evaluate/report 工作流需按 lib/types.ts 对应结构返回数据。

语音取决于服务商和浏览器能力，摄像头当前为本地预览。配置项的存在不代表已经完成线上联调。
