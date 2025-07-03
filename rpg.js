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

/**
 * @type {{
 *  world: {
 *      id: number,
 *      name: string,
 *      description: string,
 *      children: any
 *  },
 *  characters: {
 *      id: number,
 *      name: string,
 *      description: string,
 *      locationId: number,
 *      attributes: Record<string, number>
 *  }[]
 * }}
 */
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
/**
 * 通过ID查找地点
 * @param {Object} node 起始节点
 * @param {number} id 要查找的地点ID
 * @returns {Object|null} 找到的地点对象，未找到返回null
 */
function findLocationById(node, id) {
    if (!node) return null
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

/**
 * 查找地点的父节点
 * @param {Object} root 根节点
 * @param {number} id 要查找的地点ID
 * @returns {Object|null} 父节点对象，未找到返回null
 */
function findParentLocation(root, id) {
    if (!root || !root.children) return null

    // 检查直接子节点
    for (const child of root.children) {
        if (child.id === id) {
            return root
        }
    }

    // 递归检查子节点的子节点
    for (const child of root.children) {
        const found = findParentLocation(child, id)
        if (found) return found
    }

    return null
}

/**
 * 获取地点的完整路径
 * @param {Object} root 根节点
 * @param {number} id 地点ID
 * @returns {Array} 从根到目标地点的路径数组
 */
function getLocationPath(root, id) {
    const path = []
    let current = findLocationById(root, id)

    if (!current) return []

    // 从目标节点向上查找直到根节点
    while (current && current.id !== root.id) {
        path.unshift(current)
        const parent = findParentLocation(root, current.id)
        if (!parent) break
        current = parent
    }

    // 添加根节点
    if (root) {
        path.unshift(root)
    }

    return path
}

server.tool(
    "create_character",
    {
        name: z.string(),
        personality: z.string(),
        description: z.string(),
        locationId: z.number(),
    },
    async (args) => {
        if (!json.world) {
            return ToolError("请先创建世界")
        }
        if (args.locationId) {
            const location = findLocationById(json.world, args.locationId)
            if (!location) {
                return ToolError(`找不到ID为${args.locationId}的地点`)
            }
        }
        if (!json.characters) {
            json.characters = []
        }
        const characters = json.characters
        let newId = 1
        if (characters.length > 0) {
            newId = Math.max(...characters.map(c => c.id)) + 1
        }
        characters.push({
            id: newId,
            name: args.name,
            personality: args.personality,
            description: args.description,
            locationId: args.locationId,
        })
        saveJson()
        return ToolResponse(`角色'${args.name}'创建成功，角色的ID: ${newId}`)
    }
)

server.tool(
    "list_characters",
    async () => {
        const characters = json.characters || []
        if (characters.length === 0) {
            return ToolResponse("当前角色数量为0。")
        }
        return ToolResponse(JSON.stringify(json.characters))
    }
)

server.tool(
    "delete_character",
    {
        id: z.number(),
    },
    async (args) => {
        const characters = json.characters || []
        const index = characters.findIndex(c => c.id === args.id)
        if (index === -1) {
            return ToolError(`未找到ID为${args.id}的角色`)
        }
        json.characters.splice(index, 1)
        saveJson()
        return ToolResponse(`成功删除ID为${args.id}的角色`)
    }
)

server.tool(
    "update_character",
    {
        id: z.number(),
        name: z.string().optional(),
        personality: z.string().optional(),
        description: z.string().optional(),
        locationId: z.number().optional(),
    },
    async (args) => {
        const characters = json.characters || []
        const index = characters.findIndex(c => c.id === args.id)
        if (index === -1) {
            return ToolError(`未找到ID为${args.id}的角色`)
        }
        if (args.locationId) {
            const location = findLocationById(json.world, args.locationId)
            if (!location) {
                return ToolError(`找不到ID为${args.locationId}的地点`)
            }
        }
        const character = characters[index]
        if (args.name) {
            character.name = args.name
        }
        if (args.personality) {
            character.personality = args.personality
        }
        if (args.description) {
            character.description = args.description
        }
        if (args.locationId) {
            character.locationId = args.locationId
        }
        saveJson()
        return ToolResponse(`角色'${character.name}'更新成功`)
    }
)

server.tool(
    "get_character",
    {
        id: z.number(),
    },
    async (args) => {
        const characters = json.characters || []
        const character = characters.find(c => c.id === args.id)
        if (!character) {
            return ToolError(`未找到ID为${args.id}的角色`)
        }
        return ToolResponse(JSON.stringify(character))
    }
)

/**
 * 获取所有地点的扁平化列表
 * @param {Object} node 起始节点
 * @param {number} depth 当前深度
 * @returns {Array} 所有地点的数组
 */
function getAllLocations(node, depth = 0) {
    if (!node) return []

    // 创建当前节点的副本，避免修改原始数据
    const nodeCopy = { ...node }

    // 添加深度信息
    nodeCopy.depth = depth

    // 获取父节点信息
    const parent = findParentLocation(json.world, node.id)
    if (parent) {
        nodeCopy.parentId = parent.id
    }

    // 获取路径信息
    const path = getLocationPath(json.world, node.id)
    nodeCopy.path = path.map(loc => ({
        id: loc.id,
        name: loc.name
    }))

    // 移除子节点，避免循环引用
    delete nodeCopy.children

    let locations = [nodeCopy]

    // 递归处理子节点
    if (node.children) {
        for (const child of node.children) {
            locations = locations.concat(getAllLocations(child, depth + 1))
        }
    }

    return locations
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
            createdAt: new Date().toISOString()
        }
        if (!parentLocation.children) {
            parentLocation.children = []
        }
        parentLocation.children.push(newLocation)
        saveJson()
        return ToolResponse(`地点创建成功，ID: ${newLocation.id}`)
    }
)

server.tool(
    "update_location",
    "更新地点信息",
    {
        id: z.number().describe('要更新的地点ID'),
        name: z.string().optional().describe('新的地点名称'),
        description: z.string().min(100).optional().describe('新的地点描述'),
    },
    async (args) => {
        if (!json.world) {
            return ToolError("没有世界，请先创建世界")
        }

        const location = findLocationById(json.world, args.id)
        if (!location) {
            return ToolError("找不到指定的地点")
        }

        if (args.name) location.name = args.name
        if (args.description) location.description = args.description
        location.updatedAt = new Date().toISOString()

        saveJson()
        return ToolResponse("地点信息更新成功")
    }
)

server.tool(
    "delete_location",
    {
        id: z.number(),
        force: z.boolean().optional().default(false).describe('是否强制删除（包括子地点）'),
    },
    async (args) => {
        if (!json.world) {
            return ToolError("没有世界，请先创建世界")
        }
        if (args.id === json.world.id) {
            return ToolError("不能删除世界根节点")
        }
        const parent = findParentLocation(json.world, args.id)
        if (!parent || !parent.children) {
            return ToolError("找不到指定的地点或父地点")
        }

        const index = parent.children.findIndex(loc => loc.id === args.id)
        if (index === -1) {
            return ToolError("找不到指定的地点")
        }

        const location = parent.children[index]

        // 检查是否有子地点
        if (location.children && location.children.length > 0 && !args.force) {
            return ToolError("该地点包含子地点，请先删除子地点或使用force=true参数强制删除")
        }

        // 执行删除
        parent.children.splice(locationIndex, 1)
        saveJson()

        return ToolResponse(`地点"${location.name}"已删除`)
    }
)

server.tool(
    "get_location",
    "获取地点详情",
    {
        id: z.number().describe('要查询的地点ID'),
    },
    async (args) => {
        if (!json.world) {
            return ToolError("没有世界，请先创建世界")
        }

        const location = findLocationById(json.world, args.id)
        if (!location) {
            return ToolError("找不到指定的地点")
        }

        // 创建返回对象的副本，避免修改原始数据
        const result = { ...location }

        // 获取父地点信息
        const parent = findParentLocation(json.world, args.id)
        if (parent) {
            result.parent = {
                id: parent.id,
                name: parent.name
            }
        }

        // 获取子地点数量
        if (result.children) {
            result.childrenCount = result.children.length
        } else {
            result.childrenCount = 0
        }

        // 获取完整路径
        const path = getLocationPath(json.world, args.id)
        result.path = path.map(loc => ({
            id: loc.id,
            name: loc.name
        }))

        // 移除子地点列表，避免数据过大
        delete result.children

        return ToolResponse(JSON.stringify(result, null, 2))
    }
)

server.tool(
    "list_locations",
    "列出所有地点",
    {
        includeDetails: z.boolean().optional().default(false).describe('是否包含详细信息'),
    },
    async (args) => {
        if (!json.world) {
            return ToolError("没有世界，请先创建世界")
        }

        // 获取所有地点的扁平化列表
        const allLocations = getAllLocations(json.world)

        // 如果不包含详细信息，只返回基本信息
        if (!args.includeDetails) {
            const simpleList = allLocations.map(loc => ({
                id: loc.id,
                name: loc.name,
                depth: loc.depth,
                path: loc.path.map(p => p.name).join(' > ')
            }))
            return ToolResponse(JSON.stringify(simpleList))
        }

        // 返回详细信息
        return ToolResponse(JSON.stringify(allLocations))
    }
)

const transport = new StdioServerTransport()

await server.connect(transport)

console.log("MCP server start")