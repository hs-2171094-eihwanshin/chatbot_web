//chat-list/index.tsx

//챗봇의 사진, 이름, 설명
interface ChatBotProps {
    img: string;
    name: string;
    desc: string;
}

const ChatList = ({ img, name, desc }: ChatBotProps) => (
    //일정 크기 유지하도록
    <div style={{ padding: "10px", margin: "10px", border: "1px solid black", width: "400px", display: "inline-block", verticalAlign: "top" }}>
        <img src={img} alt="챗봇 이미지" style={{ width: "30px", height: "30px" }} />
        <h3>{name}</h3>
        <p>{desc}</p>
    </div>
);

export default ChatList;