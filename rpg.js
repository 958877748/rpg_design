import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import fs from 'fs'
import path from 'path'

// 检查必要的环境变量
if (!process.env.JSON) {
    console.error('错误：未设置 JSON 环境变量')
    process.exit(1)
}

const jsonPath = process.env.JSON

let str = "{}"
if (fs.existsSync(jsonPath)) {
    str = fs.readFileSync(
        path.resolve(jsonPath),
        { encoding: "utf-8" }
    )
}

const json = JSON.parse(str)

const server = new McpServer({
    name: "rpg",
    version: "1.0.0",
})

/**
 * @param {string} text 
 */
function ToolResponse(text) {
    return {
        content: [
            {
                type: "text",
                text: text
            }
        ]
    }
}

/**
 * @param {string} text 
 */
function ToolError(text) {
    return {
        isError: true,
        content: [
            {
                type: "text",
                text: text
            }
        ]
    }
}

function saveJson() {
    fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2))
}

server.tool(
    "create_world",
    "创建一个RPG游戏的世界",
    {
        name: z.string().describe('RPG游戏世界的名称'),
        description: z.string().min(100).describe('世界的描述'),
    },
    async (args) => {
        if (json.world) {
            return ToolError("世界已存在")
        }
        json.world = {
            id: 0,
            name: args.name,
            description: args.description,
        }
        saveJson()
        return ToolResponse("世界创建成功")
    }
)

server.tool(
    "get_world",
    "获取世界信息,只能同时存在一个世界",
    async () => {
        if (!json.world) {
            return ToolError("没有世界，请先创建世界")
        }
        return ToolResponse(JSON.stringify(json.world))
    }
)

// ----------------增删改查地点----------------
// 辅助函数：查找所有节点中的最大ID并返回新ID
function generateNewId(node) {
    let maxId = 0

    // 递归遍历所有节点
    function traverse(currentNode) {
        if (!currentNode) return

        // 更新最大ID
        if (currentNode.id > maxId) {
            maxId = currentNode.id
        }

        // 递归处理子节点
        if (currentNode.children) {
            for (const child of currentNode.children) {
                traverse(child)
            }
        }
    }

    // 从根节点开始遍历
    traverse(node)

    // 返回最大ID加1
    return maxId + 1
}

/**
 * 辅助函数：通过ID查找地点
 * @param {Object} node 
 * @param {number} id 
 */
function findLocationById(node, id) {
    if (node.id === id) {
        return node
    }
    if (!node.children) {
        return null
    }
    for (const child of node.children) {
        const found = findLocationById(child, id)
        if (found) return found
    }
    return null
}

server.tool(
    "create_location",
    "创建一个地点",
    {
        name: z.string().describe('地点的名称'),
        description: z.string().min(100).describe('地点的描述'),
        parentId: z.number().describe('父地点的ID'),
    },
    async (args) => {
        if (!json.world) {
            return ToolError("没有世界，请先创建世界")
        }
        const parentLocation = findLocationById(json.world, args.parentId)
        if (!parentLocation) {
            return ToolError("父地点不存在")
        }
        const newLocation = {
            id: generateNewId(json.world),
            name: args.name,
            description: args.description,
        }
        if (!parentLocation.children) {
            parentLocation.children = []
        }
        parentLocation.children.push(newLocation)
        saveJson()
        return ToolResponse("地点创建成功")
    }
)

const transport = new StdioServerTransport()

await server.connect(transport)

console.log("MCP 服务器已启动，等待请求...")