// 首页视觉演示数据，不连接数据库、不代表真实售价或库存。
// 接入 MySQL 时沿用以下商品字段，替换路由中的数据读取逻辑即可。
const categories = [
  { id: "all", name: "全部好物", icon: "grid" },
  { id: "home", name: "居家生活", icon: "home" },
  { id: "digital", name: "数码配件", icon: "headphones" },
  { id: "daily", name: "日常出行", icon: "bag" },
  { id: "stationery", name: "文具手账", icon: "book" }
];

const products = [
  { id: 1, name: "暖光蘑菇台灯", categoryId: "home", categoryName: "居家生活", description: "一盏柔光，陪你度过安静的夜晚。", price: "129.00", image: "/images/lamp.svg", tag: "人气之选", color: "sand" },
  { id: 2, name: "随行陶瓷马克杯", categoryId: "home", categoryName: "居家生活", description: "温润的触感，装下每天的第一杯温暖。", price: "59.00", image: "/images/mug.svg", tag: "日常灵感", color: "sage" },
  { id: 3, name: "轻享无线耳机", categoryId: "digital", categoryName: "数码配件", description: "给日常按下播放键，留一点时间给自己。", price: "199.00", image: "/images/headphones.svg", tag: "编辑推荐", color: "stone" },
  { id: 4, name: "简约帆布托特包", categoryId: "daily", categoryName: "日常出行", description: "轻装出门，把喜欢和日常一起装进去。", price: "79.00", image: "/images/tote.svg", tag: "轻松出行", color: "peach" },
  { id: 5, name: "留白方格手账本", categoryId: "stationery", categoryName: "文具手账", description: "写下灵感，也记录那些平凡的小美好。", price: "35.00", image: "/images/notebook.svg", tag: "记录生活", color: "paper" },
  { id: 6, name: "原木静音小闹钟", categoryId: "home", categoryName: "居家生活", description: "让时间慢一点，让生活多一点从容。", price: "89.00", image: "/images/clock.svg", tag: "温柔陪伴", color: "clay" }
];

module.exports = { categories, products };
