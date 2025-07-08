import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import fs from 'fs'
import path from 'path'
import os from 'os'

const userHomeDir = os.homedir()
const documentsPath = path.join(userHomeDir, 'Documents')
const jsonPath = path.join(documentsPath, 'rpg.json')

let str = "{}"
if (fs.existsSync(jsonPath)) {
    str = fs.readFileSync(path.resolve(jsonPath), { encoding: "utf-8" })
}

class Data {
    /** @type {number} */
    id
    /** @type {string} */
    name
    /** @type {string} */
    description
}

class Location extends Data {
    /** @type {Location[]} */
    children
}

class Character extends Data {
    /** @type {string} */
    personality
    /** @type {number} */
    locationId
}
class Plot extends Data {
    /** @type {string} */
    time
    /** @type {number} */
    locationId
    /** @type {number[]} */
    characterIds
}

/**
 * @type {{
 *  world: Location,
 *  characters: Character[],
 *  plots: Plot[]
 * }}
 */
const json = JSON.parse(str)

function saveJson() {
    fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2))
}

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


function generateNewLocationId() {
    let maxId = 0
    /**
     * @param {Location} location 
     */
    function traverse(location) {
        if (location) {
            maxId = Math.max(maxId, location.id)
            if (location.children) {
                for (const child of location.children) {
                    traverse(child)
                }
            }
        }
    }
    traverse(json.world)
    return maxId + 1
}

/**
 * @param {Location} location 起始节点
 * @param {number} id 要查找的地点ID
 * @returns {Location}
 */
function findLocationById(location, id) {
    if (location.id === id) {
        return location
    }
    if (location.children) {
        for (const child of location.children) {
            const found = findLocationById(child, id)
            if (found) return found
        }
    }
}

/**
 * 查找地点的父节点
 * @param {Location} location
 * @param {number} id 要查找的地点ID
 * @returns {Location} 父节点对象
 */
function findParentLocation(location, id) {
    if (location.children) {
        for (const child of location.children) {
            if (child.id === id) {
                return location
            }
            const foundParent = findParentLocation(child, id)
            if (foundParent) {
                return foundParent
            }
        }
    }
    return null
}

/**
 * 获取地点的完整路径
 * @param {Location} root 根节点
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
    "createWorld",
    {
        name: z.string(),
        description: z.string(),
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
        return ToolResponse(`世界创建成功，ID: ${json.world.id}`)
    }
)

server.tool(
    "getWorld",
    async () => {
        if (!json.world) {
            return ToolError("没有世界，请先创建世界")
        }
        return ToolResponse(JSON.stringify(json.world))
    }
)

server.tool(
    "createCharacter",
    {
        name: z.string(),
        description: z.string(),
        personality: z.string(),
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
        const character = new Character()
        character.id = newId
        character.name = args.name
        character.description = args.description
        character.personality = args.personality
        character.locationId = args.locationId
        characters.push(character)
        saveJson()
        return ToolResponse(`角色'${args.name}'创建成功，角色的ID: ${newId}`)
    }
)

server.tool(
    "listCharacters",
    async () => {
        const characters = json.characters || []
        if (characters.length === 0) {
            return ToolResponse("当前角色数量为0。")
        }
        return ToolResponse(JSON.stringify(json.characters))
    }
)

server.tool(
    "deleteCharacter",
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
    "updateCharacter",
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
        if (args.description) {
            character.description = args.description
        }
        if (args.personality) {
            character.personality = args.personality
        }
        if (args.locationId) {
            character.locationId = args.locationId
        }
        saveJson()
        return ToolResponse(`角色'${character.name}'更新成功`)
    }
)

server.tool(
    "getCharacter",
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

server.tool(
    "createLocation",
    {
        name: z.string(),
        description: z.string(),
        parentId: z.number(),
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
            id: generateNewLocationId(),
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
    "updateLocation",
    {
        id: z.number(),
        name: z.string().optional(),
        description: z.string().optional(),
    },
    async (args) => {
        if (!json.world) {
            return ToolError("没有世界，请先创建世界")
        }
        const location = findLocationById(json.world, args.id)
        if (!location) {
            return ToolError("找不到指定的地点")
        }
        if (args.name) {
            location.name = args.name
        }
        if (args.description) {
            location.description = args.description
        }
        location.updatedAt = new Date().toISOString()
        saveJson()
        return ToolResponse("地点信息更新成功")
    }
)

server.tool(
    "deleteLocation",
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
        if (location.children && location.children.length > 0 && !args.force) {
            return ToolError("该地点包含子地点，请先删除子地点或使用force=true参数强制删除")
        }
        parent.children.splice(index, 1)
        saveJson()
        return ToolResponse(`地点"${location.name}"已删除`)
    }
)

server.tool(
    "getLocation",
    {
        id: z.number()
    },
    async (args) => {
        if (!json.world) {
            return ToolError("没有世界，请先创建世界")
        }
        const location = findLocationById(json.world, args.id)
        if (!location) {
            return ToolError("找不到指定的地点")
        }
        const result = new Location()
        result.id = location.id
        result.name = location.name
        result.description = location.description
        result.createdAt = location.createdAt
        result.updatedAt = location.updatedAt
        return ToolResponse(JSON.stringify(result))
    }
)

server.tool(
    "listLocations",
    {
        includeDetails: z.boolean().optional().default(false).describe('是否包含详细信息'),
    },
    async (args) => {
        if (!json.world) {
            return ToolError("没有世界，请先创建世界")
        }
        const allLocations = getAllLocations(json.world)
        if (!args.includeDetails) {
            const simpleList = allLocations.map(loc => ({
                id: loc.id,
                name: loc.name,
                depth: loc.depth,
                path: loc.path.map(p => p.name).join(' > ')
            }))
            return ToolResponse(JSON.stringify(simpleList))
        }
        return ToolResponse(JSON.stringify(allLocations))
    }
)

server.tool(
    'createPlot',
    {
        id: z.number(),
        name: z.string(),
        description: z.string(),
        time: z.string(),
        locationId: z.number(),
        characterIds: z.array(z.number()),
    },
    async (args) => {
        if (!json.plots) {
            json.plots = []
        }
        if (json.plots.find(p => p.id === args.id)) {
            return ToolError(`ID为 ${args.id} 的剧情已存在。`)
        }
        const location = findLocationById(json.world, args.locationId)
        if (!location) {
            return ToolError("找不到指定的地点")
        }
        const characters = json.characters || []
        const characterIds = args.characterIds || []
        const invalidCharacterIds = characterIds.filter(id => !characters.find(c => c.id === id))
        if (invalidCharacterIds.length > 0) {
            return ToolError(`角色ID ${invalidCharacterIds.join(', ')} 不存在`)
        }
        const plot = new Plot()
        plot.id = args.id
        plot.name = args.name
        plot.description = args.description
        plot.time = args.time
        plot.locationId = args.locationId
        plot.characterIds = args.characterIds
        json.plots.push(plot)
        saveJson()
        return ToolResponse(`剧情 (ID: ${plot.id}) 已创建。`)
    }
)

server.tool(
    'deletePlot',
    {
        id: z.number(),
    },
    async (args) => {
        const index = json.plots.findIndex(p => p.id === args.id)
        if (index > -1) {
            json.plots.splice(index, 1)
            saveJson()
            return ToolResponse(`剧情 (ID: ${args.id}) 已删除。`)
        } else {
            return ToolError(`未找到ID为 ${args.id} 的剧情。`)
        }
    }
)

server.tool(
    'updatePlot',
    {
        id: z.number(),
        name: z.string().optional(),
        description: z.string().optional(),
        time: z.string().optional(),
        locationId: z.number().optional(),
        characterIds: z.array(z.number()).optional(),
    },
    async (args) => {
        const plot = json.plots.find(p => p.id === args.id)
        if (plot) {
            if (args.locationId) {
                const location = findLocationById(json.world, args.locationId)
                if (!location) {
                    return ToolError("找不到指定的地点")
                }
            }
            if (args.characterIds) {
                const characters = json.characters || []
                const invalidCharacterIds = args.characterIds.filter(id => !characters.find(c => c.id === id))
                if (invalidCharacterIds.length > 0) {
                    return ToolError(`角色ID ${invalidCharacterIds.join(', ')} 不存在`)
                }
            }
            if (args.name) plot.name = args.name
            if (args.description) plot.description = args.description
            if (args.time) plot.time = args.time
            if (args.locationId) plot.locationId = args.locationId
            if (args.characterIds) plot.characterIds = args.characterIds
            saveJson()
            return ToolResponse(`剧情 (ID: ${plot.id}) 已更新。`)
        } else {
            return ToolError(`未找到ID为 ${args.id} 的剧情。`)
        }
    }
)

server.tool(
    'listPlots',
    {
        ids: z.array(z.number())
    },
    async (args) => {
        if (!json.plots) {
            return ToolResponse("当前剧情数量为0。")
        }
        const plots = []
        args.ids.forEach(id => {
            const plot = json.plots.find(p => p.id === id)
            if (plot) {
                plots.push(plot)
            }
        })
        // 按照ID从小到大排序
        plots = plots.sort((a, b) => a.id - b.id)
        return ToolResponse(JSON.stringify(plots))
    }
)

const transport = new StdioServerTransport()

await server.connect(transport)

console.log("MCP server start")