// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const iconv = require('iconv-lite'); // 注意：需要安装这个包

// 关联的云空间文件夹路径列表
let associatedCloudFolders = [];

// 文件装饰提供器，用于修改文件图标
class CloudSpaceDecorationProvider {
	constructor() {
		this._onDidChangeFileDecorations = new vscode.EventEmitter();
		this.onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
	}

	provideFileDecoration(uri) {
		// 检查是否是已关联的云空间文件夹
		if (this.isAssociatedCloudFolder(uri.fsPath)) {
			// 返回装饰，使用特殊图标和徽章
			return {
				badge: '✓', // 使用勾选符号作为徽章
				color: new vscode.ThemeColor('charts.blue'), // 使用蓝色
				tooltip: '已关联云空间'
			};
		}
		return null;
	}

	isAssociatedCloudFolder(filePath) {
		return associatedCloudFolders.some(folder => 
			folder.toLowerCase() === filePath.toLowerCase());
	}

	// 更新装饰
	updateDecorations() {
		this._onDidChangeFileDecorations.fire(undefined); // 触发更新所有装饰
	}
}

// 云空间树视图提供器
class CloudSpaceTreeDataProvider {
	constructor() {
		this._onDidChangeTreeData = new vscode.EventEmitter();
		this.onDidChangeTreeData = this._onDidChangeTreeData.event;
	}

	refresh() {
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(element) {
		const uri = vscode.Uri.file(element);
		const treeItem = new vscode.TreeItem(
			uri,
			vscode.TreeItemCollapsibleState.Collapsed
		);
		
		// 设置标签为文件夹名称
		treeItem.label = path.basename(element);
		
		// 设置图标
		treeItem.iconPath = new vscode.ThemeIcon('cloud');
		
		// 设置上下文菜单
		treeItem.contextValue = 'cloudSpaceFolder';
		
		// 设置工具提示
		const provider = this.getProviderFromPath(element);
		if (provider) {
			treeItem.tooltip = `已关联的${provider.label}云空间`;
			// 设置描述
			treeItem.description = provider.label;
		} else {
			treeItem.tooltip = '已关联的云空间';
		}
		
		// 设置命令，点击时打开文件夹
		treeItem.command = {
			command: 'revealInExplorer',
			title: '在资源管理器中显示',
			arguments: [uri]
		};
		
		return treeItem;
	}

	getChildren(element) {
		if (element) {
			// 如果提供了元素，则返回该文件夹的子项
			// 这里我们不显示子项，所以返回空数组
			return [];
		} else {
			// 返回顶级项 - 关联的云空间文件夹
			return associatedCloudFolders;
		}
	}
	
	// 从路径获取云服务商信息
	getProviderFromPath(filePath) {
		const folderName = path.basename(filePath);
		if (folderName === 'uniCloud-aliyun') {
			return { id: 'aliyun', label: '阿里云' };
		} else if (folderName === 'uniCloud-tcb') {
			return { id: 'tcb', label: '腾讯云' };
		} else if (folderName === 'uniCloud-alipay') {
			return { id: 'alipay', label: '支付宝' };
		}
		return null;
	}
}

/**
 * 扩展 QuickPickItem 的自定义类型，添加 id 字段和其他可能需要的自定义属性
 * @typedef {Object} CustomQuickPickItem
 * @property {string} label - 显示的标签
 * @property {string} id - 标识符
 * @property {string} [description] - 可选描述
 * @property {string} [detail] - 可选详情
 * @property {boolean} [picked] - 是否被选中
 */

// 获取CLI路径
function getCLIPath() {
	const config = vscode.workspace.getConfiguration('unicloud-cli');
	return config.get('cliPath');
}

// 获取云空间配置
function getSpaceConfig(provider) {
	const config = vscode.workspace.getConfiguration('unicloud-cli');
	const spaceAssociations = config.get('spaceAssociations') || {};
	
	if (provider) {
		return spaceAssociations[provider] || null;
	}
	
	return spaceAssociations;
}

// 格式化CLI路径，处理空格和引号
function formatCliPath(cliPath) {
	// 先去除可能已存在的引号
	const cleanPath = cliPath.replace(/^"(.*)"$/, '$1');
	log(`格式化路径 - 原始路径: "${cliPath}", 清理后: "${cleanPath}"`);
	
	// 如果路径包含空格，则添加引号
	if (cleanPath.includes(' ')) {
		const formattedPath = `"${cleanPath}"`;
		log(`路径包含空格，添加引号: ${formattedPath}`);
		return formattedPath;
	}
	return cleanPath;
}

// 创建一个输出通道
let outputChannel;

// 初始化输出通道
function initOutputChannel() {
	if (!outputChannel) {
		outputChannel = vscode.window.createOutputChannel('UniCloud CLI');
	}
	return outputChannel;
}

// 输出日志
function log(message, showInUI = false) {
	const channel = initOutputChannel();
	const timestamp = new Date().toLocaleTimeString();
	const logMessage = `[${timestamp}] ${message}`;
	
	channel.appendLine(logMessage);
	console.log(logMessage);
	
	if (showInUI) {
		vscode.window.showInformationMessage(message);
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	log('扩展 "unicloud-cli" 已激活!', true);
	
	// 初始化文件装饰提供器
	const cloudSpaceDecorationProvider = new CloudSpaceDecorationProvider();
	context.subscriptions.push(
		vscode.window.registerFileDecorationProvider(cloudSpaceDecorationProvider)
	);
	
	// 初始化树视图提供器
	const cloudSpaceTreeDataProvider = new CloudSpaceTreeDataProvider();
	const treeView = vscode.window.createTreeView('uniCloudSpaces', {
		treeDataProvider: cloudSpaceTreeDataProvider,
		showCollapseAll: true
	});
	context.subscriptions.push(treeView);
	
	// 注册在资源管理器中显示文件的命令
	context.subscriptions.push(
		vscode.commands.registerCommand('revealInExplorer', (uri) => {
			vscode.commands.executeCommand('revealInExplorer', uri);
		})
	);
	
	// 加载已关联的云空间文件夹
	loadAssociatedCloudFolders();
	
	// 监听配置变化，更新关联的云空间文件夹
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('unicloud-cli.spaceAssociations')) {
				loadAssociatedCloudFolders();
				cloudSpaceDecorationProvider.updateDecorations();
				cloudSpaceTreeDataProvider.refresh();
			}
		})
	);
	
	// 检查CLI路径是否有效
	async function checkCLIPath() {
		const cliPath = getCLIPath();
		log(`当前CLI路径设置: ${cliPath}`);
		
		// 检查文件是否存在
		const pathWithoutQuotes = cliPath.replace(/^"(.*)"$/, '$1');
		if (!fs.existsSync(pathWithoutQuotes)) {
			const result = await vscode.window.showWarningMessage(
				`HBuilderX CLI工具路径不存在: ${cliPath}`,
				'配置路径',
				'忽略'
			);
			
			if (result === '配置路径') {
				vscode.commands.executeCommand('unicloud-cli.configureCLIPath');
			}
			return false;
		}
		
		// 测试CLI是否可用
		try {
			const formattedPath = formatCliPath(cliPath);
			const testCommand = `${formattedPath} project list`;
			log(`测试CLI是否可用: ${testCommand}`);
			
			const result = await executeCommand(testCommand);
			
			// 检查输出内容是否包含错误信息
			if (!result.success || result.stderr || result.stdout.includes('不匹配') || result.stdout.includes('错误')) {
				log(`CLI测试失败: ${result.stderr || result.stdout}`);
				vscode.window.showWarningMessage(
					`HBuilderX CLI工具可能无法正常工作: ${result.stderr || result.stdout || `退出码: ${result.code}`}`,
					'配置路径',
					'忽略'
				).then(option => {
					if (option === '配置路径') {
						vscode.commands.executeCommand('unicloud-cli.configureCLIPath');
					}
				});
				return false;
			} else {
				log(`CLI版本检测成功: ${result.stdout.trim()}`);
				return true;
			}
		} catch (error) {
			log(`CLI测试异常: ${error.message}`);
			return false;
		}
	}
	
	// 启动时检查CLI路径
	checkCLIPath();

	// 检查是否有打开的工作区
	function checkWorkspace() {
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
			vscode.window.showWarningMessage('请先打开一个工作区文件夹再使用unicloud-cli扩展');
			return false;
		}
		return true;
	}

	// 获取git仓库信息（如果有需要）
	async function getRepositoryInfo() {
		try {
			if (!checkWorkspace()) {
				return null;
			}
			
			// 如果需要获取git仓库信息可以在这里添加代码
			// 这里只是一个简单的示例，实际使用可能需要安装额外的库
			const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
			console.log('工作区路径：', workspaceRoot);
			return { path: workspaceRoot };
		} catch (error) {
			console.error('获取仓库信息时出错:', error);
			return null;
		}
	}

	// 查找uniCloud云函数目录
	function findCloudFunctionsDir(workspacePath) {
		const possiblePaths = [
			path.join(workspacePath, 'uniCloud-aliyun', 'cloudfunctions'),
			path.join(workspacePath, 'uniCloud-tcb', 'cloudfunctions'),
			path.join(workspacePath, 'uniCloud-alipay', 'cloudfunctions'),
			path.join(workspacePath, 'cloudfunctions')
		];

		for (const dirPath of possiblePaths) {
			if (fs.existsSync(dirPath)) {
				return dirPath;
			}
		}
		return null;
	}

	// 获取所有云函数
	function getCloudFunctions(cloudFunctionsPath) {
		if (!cloudFunctionsPath) return [];

		try {
			return fs.readdirSync(cloudFunctionsPath)
				.filter(item => {
					const itemPath = path.join(cloudFunctionsPath, item);
					return fs.statSync(itemPath).isDirectory();
				});
		} catch (error) {
			console.error('获取云函数列表失败:', error);
			return [];
		}
	}

	// 直接执行命令并处理编码
	async function executeCommand(command) {
		try {
			log(`执行命令: ${command}`);
			
			return new Promise((resolve, reject) => {
				const { exec } = require('child_process');
				
				// 使用exec直接执行命令，避免引号转义问题
				const childProcess = exec(command, {
					encoding: 'buffer'
				});
				
				let stdout = Buffer.from([]);
				let stderr = Buffer.from([]);
				
				childProcess.stdout.on('data', (data) => {
					stdout = Buffer.concat([stdout, data]);
				});
				
				childProcess.stderr.on('data', (data) => {
					stderr = Buffer.concat([stderr, data]);
				});
				
				childProcess.on('close', (code) => {
					// 使用iconv-lite转换编码
					const decodedStdout = iconv.decode(stdout, 'cp936'); // Windows中文编码
					const decodedStderr = iconv.decode(stderr, 'cp936');
					
					if (code !== 0 || decodedStderr) {
						log(`命令执行错误: ${decodedStderr}`);
						resolve({ success: false, stdout: decodedStdout, stderr: decodedStderr, code });
					} else {
						log(`命令执行成功，输出: ${decodedStdout.substring(0, 200)}${decodedStdout.length > 200 ? '...(省略)' : ''}`);
						resolve({ success: true, stdout: decodedStdout, stderr: decodedStderr, code });
					}
				});
				
				childProcess.on('error', (error) => {
					log(`命令执行异常: ${error.message}`);
					resolve({ success: false, error: error.message });
				});
			});
		} catch (error) {
			log(`命令执行异常: ${error.message}`);
			return { success: false, error: error.message };
		}
	}

	// 执行CLI命令
	async function executeCliCommand(command) {
		try {
			// 从设置中获取CLI路径
			const cliPath = getCLIPath();
			// 确保路径中的引号处理正确
			const formattedPath = formatCliPath(cliPath);
			const fullCommand = command.replace(/^cli\s/, `${formattedPath} `);
			log(`执行命令: ${fullCommand}`);
			
			// 直接使用executeCommand执行完整命令
			const cmdResult = await executeCommand(fullCommand);
			
			// 转换结果格式，确保包含message属性
			if (cmdResult.success) {
				return {
					success: true,
					message: cmdResult.stdout || ''
				};
			} else {
				return {
					success: false,
					message: cmdResult.stderr || cmdResult.error || `退出码: ${cmdResult.code}` || '未知错误'
				};
			}
		} catch (error) {
			log(`CLI命令执行异常: ${error.message}`, true);
			return { success: false, message: error.message };
		}
	}

	// 安全地分割字符串，处理null/undefined的情况
	function safeSplit(text, separator) {
		if (text === null || text === undefined) {
			log('警告: 尝试分割null/undefined字符串');
			return [];
		}
		return String(text).split(separator);
	}

	// 获取项目列表
	async function getProjectList() {
		try {
			const result = await executeCliCommand('cli project list');
			if (!result.success) {
				log('获取项目列表失败: ' + result.message, true);
				return [];
			}

			// 确保message属性存在
			if (!result.message) {
				log('获取项目列表失败: 返回结果没有内容', true);
				return [];
			}

			// 解析项目列表输出
			const lines = safeSplit(result.message, '\n').filter(line => line.trim());
			log('原始项目列表输出: ' + JSON.stringify(lines));
			
			// 根据实际输出格式解析: "序号 - 项目名称(类型)"
			/**
			 * @type {Array<{id: string, name: string}>}
			 */
			const projects = lines.map(line => {
				// 匹配格式: "序号 - 项目名称"
				const match = line.match(/^(\d+)\s+-\s+([^(]+)/);
				if (match) {
					return { 
						id: match[1].trim(), 
						name: match[2].trim()
					};
				}
				return null;
			}).filter(item => item);
			
			log(`解析后的项目列表: ${JSON.stringify(projects)}`);
			return projects;
		} catch (error) {
			log(`解析项目列表时出错: ${error.message}`, true);
			return [];
		}
	}

	// 获取或选择云服务商
	async function getOrSelectProvider() {
		// 先从工作区设置中读取已关联的云服务商列表
		const spaceConfig = getSpaceConfig();
		const providers = Object.keys(spaceConfig);
		
		// 如果有已关联的云服务商
		if (providers.length > 0) {
			// 如果只有一个云服务商，直接返回
			if (providers.length === 1) {
				const providerId = providers[0];
				const config = spaceConfig[providerId];
				log(`使用已关联的云服务商: ${providerId}`);
				return {
					id: providerId,
					label: providerId === 'aliyun' ? '阿里云' : providerId === 'tcb' ? '腾讯云' : '支付宝',
					spaceInfo: config
				};
			}
			
			// 如果有多个，让用户选择
			/**
			 * @type {Array<{id: string, label: string, description: string, spaceInfo: any}>}
			 */
			const providerList = providers.map(p => ({
				id: p,
				label: p === 'aliyun' ? '阿里云' : p === 'tcb' ? '腾讯云' : '支付宝',
				description: `已关联空间: ${spaceConfig[p].spaceName}`,
				spaceInfo: spaceConfig[p]
			}));
			
			// 添加"使用其他云服务商"选项
			providerList.push({
				id: 'other',
				label: '使用其他云服务商',
				description: '不使用已关联的云服务商',
				spaceInfo: null
			});
			
			const selectedProvider = await vscode.window.showQuickPick(
				providerList,
				{ placeHolder: '请选择云服务商' }
			);
			
			if (!selectedProvider) {
				return null;
			}
			
			// 如果选择了"使用其他云服务商"，则调用selectProvider
			if (selectedProvider.id === 'other') {
				return await selectProvider();
			}
			
			return selectedProvider;
		}
		
		// 没有已关联的云服务商，调用原有的选择方法
		return await selectProvider();
	}

	// 获取云服务商选择
	async function selectProvider() {
		/**
		 * @type {Array<import('vscode').QuickPickItem & {id: string}>}
		 */
		const providers = [
			{ label: '阿里云', id: 'aliyun', description: '阿里云服务' },
			{ label: '腾讯云', id: 'tcb', description: '腾讯云服务' },
			{ label: '支付宝', id: 'alipay', description: '支付宝服务' }
		];
		
		const provider = await vscode.window.showQuickPick(
			providers,
			{ placeHolder: '请选择云服务商' }
		);
		return provider || null;
	}

	// 获取资源类型选择
	async function selectResourceType() {
		/**
		 * @type {Array<import('vscode').QuickPickItem & {id: string}>}
		 */
		const resourceTypes = [
			{ label: '云函数', id: 'cloudfunction', description: '云端函数' },
			{ label: '公共模块', id: 'common', description: '可复用的公共模块' },
			{ label: '数据集合Schema', id: 'db', description: '数据库集合模式定义' },
			{ label: '数据库校验函数', id: 'vf', description: '数据库验证函数' },
			{ label: '数据库触发条件', id: 'action', description: '数据库操作触发器' },
			{ label: '云空间', id: 'space', description: '云服务空间' },
			{ label: '所有资源', id: 'all', description: '所有资源类型' }
		];
		
		const selectedResourceType = await vscode.window.showQuickPick(
			resourceTypes,
			{ placeHolder: '请选择资源类型' }
		);
		return selectedResourceType || null;
	}

	// 列举资源信息命令
	const listResourcesCmd = vscode.commands.registerCommand('unicloud-cli.listResources', async function () {
		log('开始执行列举资源信息命令');
		
		// 检查工作区
		if (!checkWorkspace()) {
			log('未找到有效的工作区');
			return;
		}

		// 选择项目
		const projects = await getProjectList();
		if (projects.length === 0) {
			log('未找到可用项目', true);
			return;
		}
		log(`找到 ${projects.length} 个可用项目`);

		/**
		 * @type {import('vscode').QuickPickItem & {id: string, name: string}}
		 */
		const selectedProject = await vscode.window.showQuickPick(
			projects.map(p => ({ 
				label: p.name, 
				id: p.id,
				name: p.name,
				description: `项目ID: ${p.id}`
			})),
			{ placeHolder: '请选择项目' }
		);

		if (!selectedProject) {
			log('用户取消了项目选择');
			return; // 用户取消
		}
		log(`已选择项目: ${selectedProject.label}`);

		// 选择云服务商
		const selectedProvider = await getOrSelectProvider();
		if (!selectedProvider) {
			log('用户取消了云服务商选择');
			return; // 用户取消
		}
		log(`已选择云服务商: ${selectedProvider.label}`);

		// 选择资源类型
		const selectedResourceType = await selectResourceType();
		if (!selectedResourceType) {
			log('用户取消了资源类型选择');
			return; // 用户取消
		}
		log(`已选择资源类型: ${selectedResourceType.label}`);

		// 选择是否列出云端资源
		/**
		 * @type {Array<import('vscode').QuickPickItem & {value: boolean}>}
		 */
		const cloudOptions = [
			{ label: '本地资源', value: false, description: '列出本地开发环境的资源' },
			{ label: '云端资源', value: true, description: '列出已部署到云端的资源' }
		];
		
		const isCloud = await vscode.window.showQuickPick(
			cloudOptions,
			{ placeHolder: '请选择列出本地资源还是云端资源' }
		);

		if (!isCloud) {
			log('用户取消了资源位置选择');
			return; // 用户取消
		}
		log(`已选择资源位置: ${isCloud.label}`);

		// 构建命令 - 使用项目名称而不是ID
		let command = `cli cloud functions --list ${selectedResourceType?.id || ''} --prj "${selectedProject?.name || ''}" --provider ${selectedProvider?.id || ''}`;
		if (isCloud.value) {
			command += ' --cloud';
		}
		log(`已构建命令: ${command}`);

		// 执行命令
		vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: '正在获取资源列表...',
				cancellable: false
			},
			async (progress) => {
				log('开始执行获取资源列表命令');
				const result = await executeCliCommand(command);
				
				if (result.success) {
					// 创建输出通道显示结果
					const outputChannel = initOutputChannel();
					outputChannel.clear();
					outputChannel.appendLine('资源列表:');
					outputChannel.appendLine(result.message);
					outputChannel.show();
					log('资源列表获取成功', true);
				} else {
					log(`获取资源列表失败: ${result.message}`, true);
				}
			}
		);
	});

	// 检查是否已关联云空间
	async function checkSpaceAssociation(filePath) {
		// 获取云空间配置信息
		const spaceConfig = getSpaceConfig();
		const providers = Object.keys(spaceConfig);
		
		// 如果有关联的云空间，直接返回true
		if (providers.length > 0) {
			return true;
		}
		
		// 如果没有关联的云空间，提示用户先关联
		const result = await vscode.window.showWarningMessage(
			'您尚未关联云空间，请先关联云空间再进行操作。',
			'关联云空间',
			'取消'
		);
		
		if (result === '关联云空间') {
			// 如果提供了文件路径，传递给关联命令
			if (filePath) {
				vscode.commands.executeCommand('unicloud-cli.linkFolderToSpace', vscode.Uri.file(filePath));
			} else {
				vscode.commands.executeCommand('unicloud-cli.linkFolderToSpace');
			}
		}
		
		return false;
	}

	// 上传云函数命令
	const uploadFunctionCmd = vscode.commands.registerCommand('unicloud-cli.uploadCloudFunction', async function () {
		log('开始执行上传云函数命令');
		
		// 检查工作区
		if (!checkWorkspace()) {
			log('未找到有效的工作区');
			return;
		}

		// 检查是否已关联云空间
		if (!await checkSpaceAssociation()) {
			log('未关联云空间，操作取消');
			return;
		}

		// 获取项目和提供商选择
		const projects = await getProjectList();
		if (projects.length === 0) {
			log('未找到可用项目', true);
			return;
		}
		log(`找到 ${projects.length} 个可用项目`);

		/**
		 * @type {import('vscode').QuickPickItem & {id: string, name: string}}
		 */
		const selectedProject = await vscode.window.showQuickPick(
			projects.map(p => ({ 
				label: p.name, 
				id: p.id,
				name: p.name,
				description: `项目ID: ${p.id}`
			})),
			{ placeHolder: '请选择项目' }
		);

		if (!selectedProject) {
			log('用户取消了项目选择');
			return;
		}
		log(`已选择项目: ${selectedProject.label}`);

		const selectedProvider = await getOrSelectProvider();
		if (!selectedProvider) {
			log('用户取消了云服务商选择');
			return;
		}
		log(`已选择云服务商: ${selectedProvider.label}`);

		// 选择资源类型
		/**
		 * @type {Array<import('vscode').QuickPickItem & {id: string}>}
		 */
		const resourceTypes = [
			{ label: '云函数', id: 'cloudfunction', description: '云端函数' },
			{ label: '公共模块', id: 'common', description: '可复用的公共模块' },
			{ label: '数据集合Schema', id: 'db', description: '数据库集合模式定义' },
			{ label: '数据库校验函数', id: 'vf', description: '数据库验证函数' },
			{ label: '数据库触发条件', id: 'action', description: '数据库操作触发器' },
			{ label: '所有资源', id: 'all', description: '所有资源类型' }
		];
		
		const selectedResourceType = await vscode.window.showQuickPick(
			resourceTypes,
			{ placeHolder: '请选择要上传的资源类型' }
		);

		if (!selectedResourceType) {
			log('用户取消了资源类型选择');
			return;
		}
		log(`已选择资源类型: ${selectedResourceType.label}`);

		// 如果不是上传全部资源，还需要选择具体资源
		let resourceName = '';
		let uniModName = '';

		if (selectedResourceType?.id !== 'all') {
			// 获取工作区路径
			const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
			log(`当前工作区路径: ${workspacePath}`);

			// 根据资源类型查找对应路径并获取资源列表
			let resourcePaths = [];

			if (selectedResourceType?.id === 'cloudfunction') {
				const cloudFunctionsPath = findCloudFunctionsDir(workspacePath);
				if (cloudFunctionsPath) {
					log(`找到云函数目录: ${cloudFunctionsPath}`);
					resourcePaths = getCloudFunctions(cloudFunctionsPath).map(name => ({ label: name, path: path.join(cloudFunctionsPath, name) }));
					log(`找到 ${resourcePaths.length} 个云函数`);
				} else {
					log('未找到云函数目录');
				}
			}
			// 这里应该添加其他资源类型的处理...
			// 略

			// 让用户选择具体资源
			/**
			 * @type {import('vscode').QuickPickItem & {path: string}}
			 */
			const selectedResource = await vscode.window.showQuickPick(
				resourcePaths.map(rp => ({ 
					label: rp.label, 
					path: rp.path,
					description: `路径: ${rp.path}`
				})),
				{ placeHolder: `请选择要上传的${selectedResourceType?.label || ''}` }
			);

			if (!selectedResource) {
				log('用户取消了具体资源选择');
				return;
			}
			resourceName = selectedResource?.label || '';
			log(`已选择资源: ${resourceName}`);

			// 询问是否需要指定uni_module模块名称
			/**
			 * @type {Array<import('vscode').QuickPickItem & {value: boolean}>}
			 */
			const uniModOptions = [
				{ label: '不需要', value: false, description: '不指定uni_module' },
				{ label: '需要', value: true, description: '指定uni_module模块' }
			];
			
			const needUniMod = await vscode.window.showQuickPick(
				uniModOptions,
				{ placeHolder: '是否需要指定uni_module模块名称?' }
			);

			if (!needUniMod) {
				log('用户取消了uni_module模块选择');
				return;
			}

			if (needUniMod.value) {
				uniModName = await vscode.window.showInputBox({ 
					placeHolder: '请输入uni_module模块名称',
					validateInput: text => {
						return text ? null : '请输入有效的模块名称';
					}
				});
				
				if (!uniModName) {
					log('用户取消了uni_module模块名称输入');
					return;
				}
				log(`已输入uni_module模块名称: ${uniModName}`);
			}
		} else {
			log('已选择上传所有资源');
		}

		// 构建上传命令 - 使用项目名称而不是ID
		let command = `cli cloud functions --upload ${selectedResourceType?.id || ''} --prj "${selectedProject?.name || ''}" --provider ${selectedProvider?.id || ''}`;
		
		if (resourceName) {
			command += ` --name ${resourceName}`;
		}
		
		if (uniModName) {
			command += ` --unimod ${uniModName}`;
		}
		log(`已构建上传命令: ${command}`);

		// 询问是否强制覆盖
		/**
		 * @type {Array<import('vscode').QuickPickItem & {value: boolean}>}
		 */
		const overrideOptions = [
			{ label: '否', value: false, description: '不强制覆盖' },
			{ label: '是', value: true, description: '强制覆盖现有资源' }
		];
		
		const forceOverride = await vscode.window.showQuickPick(
			overrideOptions,
			{ placeHolder: '是否强制覆盖目标资源?' }
		);

		if (!forceOverride) {
			log('用户取消了强制覆盖选择');
			return;
		}

		if (forceOverride.value) {
			command += ' --force';
			log('已添加强制覆盖选项');
		}

		// 执行上传命令
		vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `正在上传${selectedResourceType?.label || ''}...`,
				cancellable: false
			},
			async (progress) => {
				log(`开始执行上传命令: ${command}`);
				const result = await executeCliCommand(command);
				
				if (result.success) {
					const outputChannel = initOutputChannel();
					outputChannel.clear();
					outputChannel.appendLine('上传结果:');
					outputChannel.appendLine(result.message);
					outputChannel.show();
					log(`${selectedResourceType?.label || ''}上传成功!`, true);
				} else {
					log(`上传失败: ${result.message}`, true);
				}
			}
		);
	});

	// 下载云函数命令
	const downloadFunctionCmd = vscode.commands.registerCommand('unicloud-cli.downloadCloudFunction', async function () {
		log('开始执行下载云函数命令');
		
		// 检查工作区
		if (!checkWorkspace()) {
			log('未找到有效的工作区');
			return;
		}

		// 检查是否已关联云空间
		if (!await checkSpaceAssociation()) {
			log('未关联云空间，操作取消');
			return;
		}

		// 获取项目和提供商选择
		const projects = await getProjectList();
		if (projects.length === 0) {
			log('未找到可用项目', true);
			return;
		}
		log(`找到 ${projects.length} 个可用项目`);

		/**
		 * @type {import('vscode').QuickPickItem & {id: string, name: string}}
		 */
		const selectedProject = await vscode.window.showQuickPick(
			projects.map(p => ({ 
				label: p.name, 
				id: p.id,
				name: p.name,
				description: `项目ID: ${p.id}`
			})),
			{ placeHolder: '请选择项目' }
		);

		if (!selectedProject) {
			log('用户取消了项目选择');
			return;
		}
		log(`已选择项目: ${selectedProject.label}`);

		const selectedProvider = await getOrSelectProvider();
		if (!selectedProvider) {
			log('用户取消了云服务商选择');
			return;
		}
		log(`已选择云服务商: ${selectedProvider.label}`);

		// 选择资源类型
		/**
		 * @type {Array<import('vscode').QuickPickItem & {id: string}>}
		 */
		const resourceTypes = [
			{ label: '云函数', id: 'cloudfunction', description: '云端函数' },
			{ label: '公共模块', id: 'common', description: '可复用的公共模块' },
			{ label: '数据集合Schema', id: 'db', description: '数据库集合模式定义' },
			{ label: '数据库校验函数', id: 'vf', description: '数据库验证函数' },
			{ label: '数据库触发条件', id: 'action', description: '数据库操作触发器' },
			{ label: '所有资源', id: 'all', description: '所有资源类型' }
		];
		
		const selectedResourceType = await vscode.window.showQuickPick(
			resourceTypes,
			{ placeHolder: '请选择要下载的资源类型' }
		);

		if (!selectedResourceType) {
			log('用户取消了资源类型选择');
			return;
		}
		log(`已选择资源类型: ${selectedResourceType.label}`);

		// 如果不是下载全部资源，需要获取云端资源列表供用户选择
		let resourceName = '';
		let uniModName = '';

		if (selectedResourceType?.id !== 'all') {
			// 先获取云端资源列表
			const listCommand = `cli cloud functions --list ${selectedResourceType?.id || ''} --prj "${selectedProject?.name || ''}" --provider ${selectedProvider?.id || ''} --cloud`;
			log(`开始获取云端资源列表: ${listCommand}`);
			
			const listResult = await executeCliCommand(listCommand);
			
			if (!listResult.success) {
				log(`获取云端资源列表失败: ${listResult.message}`, true);
				return;
			}

			// 解析资源列表（实际需要根据CLI输出格式调整解析方式）
			/**
			 * @type {Array<import('vscode').QuickPickItem>}
			 */
			const resourceList = safeSplit(listResult.message, '\n')
				.filter(line => line.trim())
				.map(line => ({ label: line.trim(), description: '云端资源' }));

			log(`找到 ${resourceList.length} 个云端资源`);

			if (resourceList.length === 0) {
				log('未找到可下载的云端资源', true);
				return;
			}

			// 让用户选择要下载的资源
			/**
			 * @type {import('vscode').QuickPickItem}
			 */
			const selectedResource = await vscode.window.showQuickPick(
				resourceList,
				{ placeHolder: `请选择要下载的${selectedResourceType?.label || ''}` }
			);

			if (!selectedResource) {
				log('用户取消了具体资源选择');
				return;
			}
			resourceName = selectedResource?.label || '';
			log(`已选择资源: ${resourceName}`);

			// 询问是否需要指定uni_module模块名称
			/**
			 * @type {Array<import('vscode').QuickPickItem & {value: boolean}>}
			 */
			const uniModOptions = [
				{ label: '不需要', value: false, description: '不指定uni_module' },
				{ label: '需要', value: true, description: '指定uni_module模块' }
			];
			
			const needUniMod = await vscode.window.showQuickPick(
				uniModOptions,
				{ placeHolder: '是否需要指定uni_module模块名称?' }
			);

			if (!needUniMod) {
				log('用户取消了uni_module模块选择');
				return;
			}

			if (needUniMod.value) {
				uniModName = await vscode.window.showInputBox({ 
					placeHolder: '请输入uni_module模块名称',
					validateInput: text => {
						return text ? null : '请输入有效的模块名称';
					}
				});
				
				if (!uniModName) {
					log('用户取消了uni_module模块名称输入');
					return;
				}
				log(`已输入uni_module模块名称: ${uniModName}`);
			}
		} else {
			log('已选择下载所有资源');
		}

		// 构建下载命令 - 使用项目名称而不是ID
		let command = `cli cloud functions --download ${selectedResourceType?.id || ''} --prj "${selectedProject?.name || ''}" --provider ${selectedProvider?.id || ''}`;
		
		if (resourceName) {
			command += ` --name ${resourceName}`;
		}
		
		if (uniModName) {
			command += ` --unimod ${uniModName}`;
		}
		log(`已构建下载命令: ${command}`);

		// 询问是否强制覆盖
		/**
		 * @type {Array<import('vscode').QuickPickItem & {value: boolean}>}
		 */
		const overrideOptions = [
			{ label: '否', value: false, description: '不强制覆盖' },
			{ label: '是', value: true, description: '强制覆盖现有资源' }
		];
		
		const forceOverride = await vscode.window.showQuickPick(
			overrideOptions,
			{ placeHolder: '是否强制覆盖本地资源?' }
		);

		if (!forceOverride) {
			log('用户取消了强制覆盖选择');
			return;
		}

		if (forceOverride.value) {
			command += ' --force';
			log('已添加强制覆盖选项');
		}

		// 执行下载命令
		vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `正在下载${selectedResourceType?.label || ''}...`,
				cancellable: false
			},
			async (progress) => {
				log(`开始执行下载命令: ${command}`);
				const result = await executeCliCommand(command);
				
				if (result.success) {
					const outputChannel = initOutputChannel();
					outputChannel.clear();
					outputChannel.appendLine('下载结果:');
					outputChannel.appendLine(result.message);
					outputChannel.show();
					log(`${selectedResourceType?.label || ''}下载成功!`, true);
				} else {
					log(`下载失败: ${result.message}`, true);
				}
			}
		);
	});

	// 初始化数据库命令
	const initDatabaseCmd = vscode.commands.registerCommand('unicloud-cli.initDatabase', async function () {
		log('开始执行初始化数据库命令');
		
		// 检查工作区
		if (!checkWorkspace()) {
			log('未找到有效的工作区');
			return;
		}

		// 获取项目和提供商选择
		const projects = await getProjectList();
		if (projects.length === 0) {
			log('未找到可用项目', true);
			return;
		}
		log(`找到 ${projects.length} 个可用项目`);

		/**
		 * @type {import('vscode').QuickPickItem & {id: string, name: string}}
		 */
		const selectedProject = await vscode.window.showQuickPick(
			projects.map(p => ({ 
				label: p.name, 
				id: p.id,
				name: p.name,
				description: `项目ID: ${p.id}`
			})),
			{ placeHolder: '请选择项目' }
		);

		if (!selectedProject) {
			log('用户取消了项目选择');
			return;
		}
		log(`已选择项目: ${selectedProject.label}`);

		const selectedProvider = await getOrSelectProvider();
		if (!selectedProvider) {
			log('用户取消了云服务商选择');
			return;
		}
		log(`已选择云服务商: ${selectedProvider.label}`);

		// 构建初始化数据库命令 - 使用项目名称而不是ID
		const command = `cli cloud functions --prj "${selectedProject?.name || ''}" --provider ${selectedProvider?.id || ''} --initdatabase`;
		log(`已构建初始化数据库命令: ${command}`);

		// 二次确认
		const confirmed = await vscode.window.showWarningMessage(
			'确定要初始化数据库吗？此操作会重新创建数据库结构。',
			{ modal: true },
			'确定初始化'
		);

		if (confirmed !== '确定初始化') {
			log('用户取消了数据库初始化操作');
			return;
		}
		log('用户确认了数据库初始化操作');

		// 执行初始化数据库命令
		vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: '正在初始化数据库...',
				cancellable: false
			},
			async (progress) => {
				log(`开始执行初始化数据库命令: ${command}`);
				const result = await executeCliCommand(command);
				
				if (result.success) {
					log('数据库初始化成功!', true);
				} else {
					log(`数据库初始化失败: ${result.message}`, true);
				}
			}
		);
	});

	// 指定云空间命令
	const assignSpaceCmd = vscode.commands.registerCommand('unicloud-cli.assignSpace', async function () {
		log('开始执行指定云空间命令');
		
		// 检查工作区
		if (!checkWorkspace()) {
			log('未找到有效的工作区');
			return;
		}

		// 获取项目和提供商选择
		const projects = await getProjectList();
		if (projects.length === 0) {
			log('未找到可用项目', true);
			return;
		}
		log(`找到 ${projects.length} 个可用项目`);

		/**
		 * @type {import('vscode').QuickPickItem & {id: string, name: string}}
		 */
		const selectedProject = await vscode.window.showQuickPick(
			projects.map(p => ({ 
				label: p.name, 
				id: p.id,
				name: p.name,
				description: `项目ID: ${p.id}`
			})),
			{ placeHolder: '请选择项目' }
		);

		if (!selectedProject) {
			log('用户取消了项目选择');
			return;
		}
		log(`已选择项目: ${selectedProject.label}`);

		const selectedProvider = await getOrSelectProvider();
		if (!selectedProvider) {
			log('用户取消了云服务商选择');
			return;
		}
		log(`已选择云服务商: ${selectedProvider.label}`);

		// 获取云空间列表
		const listCommand = `cli cloud functions --list space --prj "${selectedProject?.name || ''}" --provider ${selectedProvider?.id || ''}`;
		log(`开始获取云空间列表: ${listCommand}`);
		
		const listResult = await executeCliCommand(listCommand);
		
		if (!listResult.success) {
			log(`获取云空间列表失败: ${listResult.message}`, true);
			return;
		}

		// 解析云空间列表
		const spaceList = [];
		const lines = safeSplit(listResult.message, '\n');
		
		// 调试所有行
		log(`总共有 ${lines.length} 行输出。完整输出: ${listResult.message}`);
		
		// 逐行处理
		for (const line of lines) {
			const trimmedLine = line.trim();
			
			// 忽略空行、标题行和结尾行
			if (!trimmedLine || trimmedLine.startsWith('PROVIDER:') || trimmedLine.startsWith('0:')) {
				continue;
			}
			
			log(`处理行: "${trimmedLine}"`);
			
			// 基本格式匹配: "序号 - 名称 [](mp-uuid)"
			// 使用宽松的正则表达式，拆成两部分处理
			const basicMatch = trimmedLine.match(/^(\d+)\s+-\s+(.+?)(?:\s+\[\]|$)/);
			if (basicMatch) {
				const id = basicMatch[1];
				const spaceName = basicMatch[2].trim();
				
				// 提取 UUID (如果存在)
				let spaceId = '';
				const uuidMatch = trimmedLine.match(/\[\]\(mp-([a-f0-9-]+)\)/i);
				if (uuidMatch) {
					spaceId = uuidMatch[1];
				}
				
				spaceList.push({ 
					label: spaceName, 
					id: id, 
					spaceName: spaceName,
					description: spaceId ? `空间ID: mp-${spaceId}` : '空间ID未知'
				});
				
				log(`匹配到云空间: ID=${id}, 名称=${spaceName}, UUID=${spaceId || '未知'}`);
			} else {
				log(`行格式无法识别: "${trimmedLine}"`);
			}
		}

		log(`找到 ${spaceList.length} 个云空间`);

		if (spaceList.length === 0) {
			log('未找到可用的云空间', true);
			return;
		}

		// 让用户选择云空间
		/**
		 * @type {import('vscode').QuickPickItem & {id: string, spaceName: string}}
		 */
		const selectedSpace = await vscode.window.showQuickPick(
			spaceList,
			{ placeHolder: '请选择要指定的云空间' }
		);

		if (!selectedSpace) {
			log('用户取消了云空间选择');
			return;
		}
		log(`已选择云空间: ${selectedSpace.spaceName}`);

		// 构建指定云空间命令 - 使用项目名称而不是ID
		const command = `cli cloud functions --prj "${selectedProject?.name || ''}" --provider ${selectedProvider?.id || ''} --assignspace ${selectedSpace?.id || ''}`;
		log(`已构建指定云空间命令: ${command}`);

		// 执行指定云空间命令
		vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `正在指定云空间 ${selectedSpace.spaceName}...`,
				cancellable: false
			},
			async (progress) => {
				log(`开始执行指定云空间命令: ${command}`);
				const result = await executeCliCommand(command);
				
				if (result.success) {
					log(`成功指定云空间: ${selectedSpace.spaceName}`, true);
				} else {
					log(`指定云空间失败: ${result.message}`, true);
				}
			}
		);
	});

	// 关联文件夹到云空间命令
	const linkFolderToSpaceCmd = vscode.commands.registerCommand('unicloud-cli.linkFolderToSpace', async function (folderUri) {
		log('开始执行关联文件夹到云空间命令');
		
		// 检查工作区
		if (!checkWorkspace()) {
			log('未找到有效的工作区');
			return;
		}

		// 获取选中的文件夹路径
		let folderPath = '';
		if (folderUri && folderUri.fsPath) {
			folderPath = folderUri.fsPath;
		} else {
			// 如果没有选择文件夹，让用户选择
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (workspaceFolders && workspaceFolders.length > 0) {
				if (workspaceFolders.length === 1) {
					folderPath = workspaceFolders[0].uri.fsPath;
				} else {
					// 如果有多个工作区文件夹，让用户选择
					const folderItems = workspaceFolders.map(folder => ({
						label: folder.name,
						description: folder.uri.fsPath,
						uri: folder.uri
					}));
					
					const selectedFolder = await vscode.window.showQuickPick(folderItems, {
						placeHolder: '请选择要关联的文件夹'
					});
					
					if (!selectedFolder) {
						log('用户取消了文件夹选择');
						return;
					}
					folderPath = selectedFolder.uri.fsPath;
				}
			} else {
				log('未找到有效的工作区文件夹');
				return;
			}
		}
		
		log(`已选择文件夹路径: ${folderPath}`);
		
		// 从文件夹名称判断云服务商
		const folderName = path.basename(folderPath);
		let detectedProvider = null;
		
		if (folderName.startsWith('uniCloud-')) {
			if (folderName === 'uniCloud-aliyun') {
				detectedProvider = { label: '阿里云', id: 'aliyun', description: '阿里云服务 (根据文件夹名称自动检测)' };
			} else if (folderName === 'uniCloud-tcb') {
				detectedProvider = { label: '腾讯云', id: 'tcb', description: '腾讯云服务 (根据文件夹名称自动检测)' };
			} else if (folderName === 'uniCloud-alipay') {
				detectedProvider = { label: '支付宝', id: 'alipay', description: '支付宝服务 (根据文件夹名称自动检测)' };
			}
			
			if (detectedProvider) {
				log(`根据文件夹名称 "${folderName}" 自动检测到云服务商: ${detectedProvider.label}`);
			}
		}
		
		// 获取项目和提供商选择
		const projects = await getProjectList();
		if (projects.length === 0) {
			log('未找到可用项目', true);
			return;
		}
		log(`找到 ${projects.length} 个可用项目`);

		/**
		 * @type {import('vscode').QuickPickItem & {id: string, name: string}}
		 */
		const selectedProject = await vscode.window.showQuickPick(
			projects.map(p => ({ 
				label: p.name, 
				id: p.id,
				name: p.name,
				description: `项目ID: ${p.id}`
			})),
			{ placeHolder: '请选择项目' }
		);

		if (!selectedProject) {
			log('用户取消了项目选择');
			return;
		}
		log(`已选择项目: ${selectedProject.label}`);

		// 如果已检测到云服务商，则优先显示并默认选中
		let selectedProvider = null;
		
		if (detectedProvider) {
			// 构建提供商列表，将检测到的提供商放在第一位
			const providers = [
				detectedProvider,
				...([
					{ label: '阿里云', id: 'aliyun', description: '阿里云服务' },
					{ label: '腾讯云', id: 'tcb', description: '腾讯云服务' },
					{ label: '支付宝', id: 'alipay', description: '支付宝服务' }
				].filter(p => p.id !== detectedProvider.id)) // 过滤掉已检测到的提供商，避免重复
			];
			
			selectedProvider = await vscode.window.showQuickPick(
				providers,
				{ 
					placeHolder: '请选择云服务商',
					title: `已自动检测到云服务商: ${detectedProvider.label}`
				}
			);
		} else {
			// 没有检测到，使用常规选择
			selectedProvider = await selectProvider();
		}
		
		if (!selectedProvider) {
			log('用户取消了云服务商选择');
			return;
		}
		log(`已选择云服务商: ${selectedProvider.label}`);

		// 获取云空间列表
		const listCommand = `cli cloud functions --list space --prj "${selectedProject?.name || ''}" --provider ${selectedProvider?.id || ''}`;
		log(`开始获取云空间列表: ${listCommand}`);
		
		const listResult = await executeCliCommand(listCommand);
		
		if (!listResult.success) {
			log(`获取云空间列表失败: ${listResult.message}`, true);
			return;
		}

		// 解析云空间列表
		const spaceList = [];
		const lines = safeSplit(listResult.message, '\n');
		
		// 调试所有行
		log(`总共有 ${lines.length} 行输出。完整输出: ${listResult.message}`);
		
		// 逐行处理
		for (const line of lines) {
			const trimmedLine = line.trim();
			
			// 忽略空行、标题行和结尾行
			if (!trimmedLine || trimmedLine.startsWith('PROVIDER:') || trimmedLine.startsWith('0:')) {
				continue;
			}
			
			log(`处理行: "${trimmedLine}"`);
			
			// 基本格式匹配: "序号 - 名称 [](mp-uuid)"
			// 使用宽松的正则表达式，拆成两部分处理
			const basicMatch = trimmedLine.match(/^(\d+)\s+-\s+(.+?)(?:\s+\[\]|$)/);
			if (basicMatch) {
				const id = basicMatch[1];
				const spaceName = basicMatch[2].trim();
				
				// 提取 UUID (如果存在)
				let spaceId = '';
				const uuidMatch = trimmedLine.match(/\[\]\(mp-([a-f0-9-]+)\)/i);
				if (uuidMatch) {
					spaceId = uuidMatch[1];
				}
				
				spaceList.push({ 
					label: spaceName, 
					id: id, 
					spaceName: spaceName,
					description: spaceId ? `空间ID: mp-${spaceId}` : '空间ID未知'
				});
				
				log(`匹配到云空间: ID=${id}, 名称=${spaceName}, UUID=${spaceId || '未知'}`);
			} else {
				log(`行格式无法识别: "${trimmedLine}"`);
			}
		}

		log(`找到 ${spaceList.length} 个云空间`);

		if (spaceList.length === 0) {
			log('未找到可用的云空间', true);
			return;
		}

		// 让用户选择云空间
		/**
		 * @type {import('vscode').QuickPickItem & {id: string, spaceName: string}}
		 */
		const selectedSpace = await vscode.window.showQuickPick(
			spaceList,
			{ placeHolder: '请选择要关联的云空间' }
		);

		if (!selectedSpace) {
			log('用户取消了云空间选择');
			return;
		}
		log(`已选择云空间: ${selectedSpace.spaceName}`);

		// 存储关联信息到工作区设置文件
		try {
			// 获取工作区配置
			const config = vscode.workspace.getConfiguration('unicloud-cli');
			
			// 构建云空间关联信息
			const spaceInfo = {
				spaceId: selectedSpace.id,
				spaceName: selectedSpace.spaceName,
				provider: selectedProvider.id,
				projectName: selectedProject.name,  // 添加项目名称
				folderPath: folderPath  // 保存文件夹路径
			};
			
			// 读取现有的云空间关联信息
			const spaceAssociations = config.get('spaceAssociations') || {};
			
			// 更新配置，将当前选择的提供商与云空间关联
			spaceAssociations[selectedProvider.id] = spaceInfo;
			
			// 更新工作区设置
			await config.update('spaceAssociations', spaceAssociations, vscode.ConfigurationTarget.Workspace);
			
			// 更新关联的云空间文件夹列表并刷新视图
			loadAssociatedCloudFolders();
			cloudSpaceDecorationProvider.updateDecorations();
			cloudSpaceTreeDataProvider.refresh();
			
			log(`成功关联文件夹 "${folderPath}" 到云空间 "${selectedSpace.spaceName}"`, true);
			vscode.window.showInformationMessage(`已成功将云空间 "${selectedSpace.spaceName}" 关联到当前工作区`);
		} catch (error) {
			log(`关联文件夹到云空间失败: ${error.message}`, true);
			vscode.window.showErrorMessage(`关联云空间失败: ${error.message}`);
		}
	});

	// 显示和管理云空间关联信息命令
	const manageSpaceAssociationsCmd = vscode.commands.registerCommand('unicloud-cli.manageSpaceAssociations', async function () {
		log('开始执行管理云空间关联信息命令');
		
		// 检查工作区
		if (!checkWorkspace()) {
			log('未找到有效的工作区');
			return;
		}
		
		// 获取当前关联的云空间信息
		const spaceConfig = getSpaceConfig();
		const providers = Object.keys(spaceConfig);
		
		if (providers.length === 0) {
			const result = await vscode.window.showInformationMessage(
				'当前工作区没有关联的云空间。',
				'关联云空间',
				'取消'
			);
			
			if (result === '关联云空间') {
				vscode.commands.executeCommand('unicloud-cli.linkFolderToSpace');
			}
			return;
		}
		
		// 构建关联信息显示项
		/**
		 * @type {Array<import('vscode').QuickPickItem & {providerId?: string, actionType?: string}>}
		 */
		const spaceItems = providers.map(p => {
			const space = spaceConfig[p];
			return {
				label: `${p === 'aliyun' ? '阿里云' : p === 'tcb' ? '腾讯云' : '支付宝'}: ${space.spaceName}`,
				description: `空间ID: ${space.spaceId}`,
				providerId: p
			};
		});
		
		// 添加管理选项
		spaceItems.push({ 
			label: '添加新关联', 
			description: '关联新的云空间到本工作区', 
			actionType: 'add' 
		});
		
		if (providers.length > 0) {
			spaceItems.push({ 
				label: '删除关联', 
				description: '删除已有的云空间关联', 
				actionType: 'delete' 
			});
		}
		
		// 显示关联信息和选项
		const selectedItem = await vscode.window.showQuickPick(
			spaceItems,
			{ 
				placeHolder: '当前工作区关联的云空间',
				title: '云空间关联管理'
			}
		);
		
		if (!selectedItem) {
			log('用户取消了云空间关联管理');
			return;
		}
		
		// 处理选择的操作
		if (selectedItem.actionType === 'add') {
			// 添加新关联
			vscode.commands.executeCommand('unicloud-cli.linkFolderToSpace');
		} else if (selectedItem.actionType === 'delete') {
			// 删除关联
			const providerToDelete = await vscode.window.showQuickPick(
				providers.map(p => ({
					label: p === 'aliyun' ? '阿里云' : p === 'tcb' ? '腾讯云' : '支付宝',
					description: `空间名称: ${spaceConfig[p].spaceName}`,
					providerId: p
				})),
				{ placeHolder: '选择要删除的云空间关联' }
			);
			
			if (!providerToDelete) {
				log('用户取消了删除操作');
				return;
			}
			
			// 确认删除
			const confirmed = await vscode.window.showWarningMessage(
				`确定要删除 ${providerToDelete.label} 云空间关联吗?`,
				{ modal: true },
				'确定删除'
			);
			
			if (confirmed === '确定删除') {
				try {
					// 获取当前配置
					const config = vscode.workspace.getConfiguration('unicloud-cli');
					const spaceAssociations = config.get('spaceAssociations') || {};
					
					// 删除指定提供商的关联信息
					delete spaceAssociations[providerToDelete.providerId];
					
					// 更新配置
					await config.update('spaceAssociations', spaceAssociations, vscode.ConfigurationTarget.Workspace);
					
					log(`已删除 ${providerToDelete.label} 的云空间关联`, true);
				} catch (error) {
					log(`删除云空间关联失败: ${error.message}`, true);
					vscode.window.showErrorMessage(`删除云空间关联失败: ${error.message}`);
				}
			}
		} else if (selectedItem.providerId) {
			// 显示选中云空间的详细信息
			const provider = selectedItem.providerId;
			const space = spaceConfig[provider];
			
			const infoMessage = 
				`服务商: ${provider === 'aliyun' ? '阿里云' : provider === 'tcb' ? '腾讯云' : '支付宝'}\n` +
				`空间名称: ${space.spaceName}\n` +
				`空间ID: ${space.spaceId}`;
			
			vscode.window.showInformationMessage(infoMessage);
		}
	});

	// Hello World命令
	const disposable = vscode.commands.registerCommand('unicloud-cli.helloWorld', async function () {
		log('开始执行Hello World命令');
		
		// 首先检查工作区是否存在
		if (!checkWorkspace()) {
			log('未找到有效的工作区');
			return;
		}

		// 获取仓库信息（如果需要）
		const repoResult = await getRepositoryInfo();
		if (repoResult === null) {
			log('未获取到仓库信息，但可以继续其他操作');
		} else {
			log(`仓库路径: ${repoResult.path}`);
		}

		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		log('Hello World from unicloud cli!', true);
	});

	// 配置CLI路径命令
	const configureCLIPathCmd = vscode.commands.registerCommand('unicloud-cli.configureCLIPath', async function () {
		log('开始执行配置CLI路径命令');
		
		// 获取当前配置
		const config = vscode.workspace.getConfiguration('unicloud-cli');
		const currentPath = config.get('cliPath');
		
		// 询问用户是否要手动输入路径或浏览选择
		const pathSelectOptions = [
			{ label: '手动输入路径', id: 'input' },
			{ label: '浏览选择文件', id: 'browse' }
		];
		
		const pathSelectMethod = await vscode.window.showQuickPick(pathSelectOptions, {
			placeHolder: '请选择CLI路径设置方式'
		});
		
		if (!pathSelectMethod) {
			log('用户取消了CLI路径配置');
			return;
		}
		
		let newPath = currentPath;
		
		if (pathSelectMethod.id === 'input') {
			// 手动输入路径
			newPath = await vscode.window.showInputBox({
				value: currentPath,
				placeHolder: 'HBuilderX CLI 工具的路径，例如: C:\\Program Files\\HBuilderX\\cli.exe',
				prompt: '请输入HBuilderX CLI工具的完整路径'
			});
			
			if (!newPath) {
				log('用户取消了路径输入');
				return;
			}
		} else if (pathSelectMethod.id === 'browse') {
			// 浏览选择文件
			const fileUris = await vscode.window.showOpenDialog({
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: false,
				openLabel: '选择',
				filters: {
					'可执行文件': ['exe']
				},
				title: '请选择HBuilderX CLI工具(cli.exe)'
			});
			
			if (!fileUris || fileUris.length === 0) {
				log('用户取消了文件选择');
				return;
			}
			
			newPath = fileUris[0].fsPath;
		}
		
		// 去除路径中的引号，保存到配置中
		newPath = newPath.replace(/^"(.*)"$/, '$1');
		
		// 更新配置
		await config.update('cliPath', newPath, vscode.ConfigurationTarget.Global);
		log(`CLI路径已更新为: ${newPath}`, true);
		
		// 检测CLI是否可用
		try {
			const formattedPath = formatCliPath(newPath);
			const testCommand = `${formattedPath} project list`;
			log(`测试CLI是否可用: ${testCommand}`);
			
			const result = await executeCommand(testCommand);
			
			if (!result.success) {
				const errorMsg = result.stderr;
				log(`CLI测试失败: ${errorMsg || `退出码: ${result.code}`}`, true);
				vscode.window.showWarningMessage(`CLI路径设置可能有误: ${errorMsg || `退出码: ${result.code}`}`);
			} else {
				const output = result.stdout;
				log(`CLI测试成功，输出: ${output.substring(0, 100)}${output.length > 100 ? '...(省略)' : ''}`);
				vscode.window.showInformationMessage('CLI路径设置正确，测试通过!');
			}
		} catch (error) {
			log(`CLI测试异常: ${error.message}`, true);
			vscode.window.showErrorMessage(`无法测试CLI: ${error.message}`);
		}
	});

	// 上传单个云函数命令（右键菜单）
	const uploadSingleCloudFunctionCmd = vscode.commands.registerCommand('unicloud-cli.uploadSingleCloudFunction', async function (uri) {
		log('开始执行上传单个云函数命令（右键菜单）');
		
		// 检查工作区
		if (!checkWorkspace()) {
			log('未找到有效的工作区');
			return;
		}
		// 检查是否关联了云空间
		if (!await checkSpaceAssociation()) {
			log('未关联云空间，操作取消');
			return;
		}
		// 获取选中的文件夹路径
		if (!uri || !uri.fsPath) {
			log('未选择云函数文件夹');
			return;
		}
		
		const cloudFunctionPath = uri.fsPath;
		const cloudFunctionName = path.basename(cloudFunctionPath);
		log(`已选择云函数: ${cloudFunctionName}, 路径: ${cloudFunctionPath}`);
		
		// 检查是否已关联云空间
		if (!await checkSpaceAssociation(findCloudSpaceRoot(cloudFunctionPath))) {
			log('未关联云空间，操作取消');
			return;
		}
		
		// 获取项目和提供商信息
		const result = await getProjectAndProviderFromAssociation(cloudFunctionPath);
		if (result.cancelled) {
			return; // 用户取消了操作
		}
		
		// 询问是否强制覆盖
		/**
		 * @type {Array<import('vscode').QuickPickItem & {value: boolean}>}
		 */
		const overrideOptions = [
			{ label: '是', value: true, description: '强制覆盖现有资源' },
			{ label: '否', value: false, description: '不强制覆盖' }
		];
		
		const forceOverride = await vscode.window.showQuickPick(
			overrideOptions,
			{ placeHolder: '是否强制覆盖目标资源?' }
		);

		if (!forceOverride) {
			log('用户取消了强制覆盖选择');
			return;
		}
		
		// 构建上传命令
		let command = `cli cloud functions --upload cloudfunction --prj "${result.projectName}" --provider ${result.provider?.id || ''} --name ${cloudFunctionName}`;
		
		// 如果需要强制覆盖
		if (forceOverride.value) {
			command += ' --force';
		}
		
		// 执行上传命令
		vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `正在上传云函数 ${cloudFunctionName}...`,
				cancellable: false
			},
			async (progress) => {
				log(`开始执行上传命令: ${command}`);
				const result = await executeCliCommand(command);
				
				if (result.success) {
					log(`云函数 ${cloudFunctionName} 上传成功!`, true);
				} else {
					log(`上传失败: ${result.message}`, true);
				}
			}
		);
	});
	
	// 上传所有云函数命令（右键菜单）
	const uploadAllCloudFunctionsCmd = vscode.commands.registerCommand('unicloud-cli.uploadAllCloudFunctions', async function (uri) {
		log('开始执行上传所有云函数命令（右键菜单）');
		
		// 检查工作区
		if (!checkWorkspace()) {
			log('未找到有效的工作区');
			return;
		}
		// 检查是否关联了云空间
		if (!await checkSpaceAssociation()) {
			log('未关联云空间，操作取消');
			return;
		}
		// 获取选中的文件夹路径
		if (!uri || !uri.fsPath) {
			log('未选择cloudfunctions文件夹');
			return;
		}
		
		const cloudFunctionsPath = uri.fsPath;
		log(`已选择cloudfunctions文件夹: ${cloudFunctionsPath}`);
		
		// 检查是否已关联云空间
		if (!await checkSpaceAssociation(findCloudSpaceRoot(cloudFunctionsPath))) {
			log('未关联云空间，操作取消');
			return;
		}
		
		// 获取项目和提供商信息
		const result = await getProjectAndProviderFromAssociation(cloudFunctionsPath);
		if (result.cancelled) {
			return; // 用户取消了操作
		}
		
		// 询问是否强制覆盖
		/**
		 * @type {Array<import('vscode').QuickPickItem & {value: boolean}>}
		 */
		const overrideOptions = [
			{ label: '是', value: true, description: '强制覆盖现有资源' },
			{ label: '否', value: false, description: '不强制覆盖' }
		];
		
		const forceOverride = await vscode.window.showQuickPick(
			overrideOptions,
			{ placeHolder: '是否强制覆盖目标资源?' }
		);

		if (!forceOverride) {
			log('用户取消了强制覆盖选择');
			return;
		}
		
		// 构建上传命令
		let command = `cli cloud functions --upload all --prj "${result.projectName}" --provider ${result.provider?.id || ''}`;
		
		// 如果需要强制覆盖
		if (forceOverride.value) {
			command += ' --force';
		}
		
		// 执行上传命令
		vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: '正在上传所有云函数...',
				cancellable: false
			},
			async (progress) => {
				log(`开始执行上传命令: ${command}`);
				const result = await executeCliCommand(command);
				
				if (result.success) {
					log('所有云函数上传成功!', true);
				} else {
					log(`上传失败: ${result.message}`, true);
				}
			}
		);
	});
	
	// 上传数据库Schema命令（右键菜单）
	const uploadDatabaseCmd = vscode.commands.registerCommand('unicloud-cli.uploadDatabase', async function (uri) {
		log('开始执行上传数据库Schema命令（右键菜单）');
		
		// 检查工作区
		if (!checkWorkspace()) {
			log('未找到有效的工作区');
			return;
		}
		// 检查是否关联了云空间
		if (!await checkSpaceAssociation()) {
			log('未关联云空间，操作取消');
			return;
		}
		// 获取选中的文件夹路径
		if (!uri || !uri.fsPath) {
			log('未选择database文件夹');
			return;
		}
		
		const databasePath = uri.fsPath;
		log(`已选择database文件夹: ${databasePath}`);
		
		// 检查是否已关联云空间
		if (!await checkSpaceAssociation(findCloudSpaceRoot(databasePath))) {
			log('未关联云空间，操作取消');
			return;
		}
		
		// 获取项目和提供商信息
		const result = await getProjectAndProviderFromAssociation(databasePath);
		if (result.cancelled) {
			return; // 用户取消了操作
		}
		
		// 询问是否强制覆盖
		/**
		 * @type {Array<import('vscode').QuickPickItem & {value: boolean}>}
		 */
		const overrideOptions = [
			{ label: '是', value: true, description: '强制覆盖现有资源' },
			{ label: '否', value: false, description: '不强制覆盖' }
		];
		
		const forceOverride = await vscode.window.showQuickPick(
			overrideOptions,
			{ placeHolder: '是否强制覆盖目标资源?' }
		);

		if (!forceOverride) {
			log('用户取消了强制覆盖选择');
			return;
		}
		
		// 构建上传命令
		let command = `cli cloud functions --upload db --prj "${result.projectName}" --provider ${result.provider?.id || ''}`;
		
		// 如果需要强制覆盖
		if (forceOverride.value) {
			command += ' --force';
		}
		
		// 执行上传命令
		vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: '正在上传数据库Schema...',
				cancellable: false
			},
			async (progress) => {
				log(`开始执行上传命令: ${command}`);
				const result = await executeCliCommand(command);
				
				if (result.success) {
					log('数据库Schema上传成功!', true);
				} else {
					log(`上传失败: ${result.message}`, true);
				}
			}
		);
	});

	// 下载单个云函数命令（右键菜单）
	const downloadSingleCloudFunctionCmd = vscode.commands.registerCommand('unicloud-cli.downloadSingleCloudFunction', async function (uri) {
		log('开始执行下载单个云函数命令（右键菜单）');
		
		// 检查工作区
		if (!checkWorkspace()) {
			log('未找到有效的工作区');
			return;
		}
		// 检查是否关联了云空间
		if (!await checkSpaceAssociation()) {
			log('未关联云空间，操作取消');
			return;
		}
		// 获取选中的文件夹路径
		if (!uri || !uri.fsPath) {
			log('未选择云函数文件夹');
			return;
		}
		
		const cloudFunctionPath = uri.fsPath;
		const cloudFunctionName = path.basename(cloudFunctionPath);
		log(`已选择云函数: ${cloudFunctionName}, 路径: ${cloudFunctionPath}`);
		
		// 检查是否已关联云空间
		if (!await checkSpaceAssociation(findCloudSpaceRoot(cloudFunctionPath))) {
			log('未关联云空间，操作取消');
			return;
		}
		
		// 获取项目和提供商信息
		const result = await getProjectAndProviderFromAssociation(cloudFunctionPath);
		if (result.cancelled) {
			return; // 用户取消了操作
		}
		
		// 询问是否强制覆盖
		/**
		 * @type {Array<import('vscode').QuickPickItem & {value: boolean}>}
		 */
		const overrideOptions = [
			{ label: '是', value: true, description: '强制覆盖本地资源' },
			{ label: '否', value: false, description: '不强制覆盖' }
		];
		
		const forceOverride = await vscode.window.showQuickPick(
			overrideOptions,
			{ placeHolder: '是否强制覆盖本地资源?' }
		);

		if (!forceOverride) {
			log('用户取消了强制覆盖选择');
			return;
		}
		
		// 构建下载命令
		let command = `cli cloud functions --download cloudfunction --prj "${result.projectName}" --provider ${result.provider?.id || ''} --name ${cloudFunctionName}`;
		
		// 如果需要强制覆盖
		if (forceOverride.value) {
			command += ' --force';
		}
		
		// 执行下载命令
		vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `正在下载云函数 ${cloudFunctionName}...`,
				cancellable: false
			},
			async (progress) => {
				log(`开始执行下载命令: ${command}`);
				const result = await executeCliCommand(command);
				
				if (result.success) {
					log(`云函数 ${cloudFunctionName} 下载成功!`, true);
				} else {
					log(`下载失败: ${result.message}`, true);
				}
			}
		);
	});
	
	// 下载所有云函数命令（右键菜单）
	const downloadAllCloudFunctionsCmd = vscode.commands.registerCommand('unicloud-cli.downloadAllCloudFunctions', async function (uri) {
		log('开始执行下载所有云函数命令（右键菜单）');
		
		// 检查工作区
		if (!checkWorkspace()) {
			log('未找到有效的工作区');
			return;
		}
		// 检查是否关联了云空间
		if (!await checkSpaceAssociation()) {
			log('未关联云空间，操作取消');
			return;
		}
		// 获取选中的文件夹路径
		if (!uri || !uri.fsPath) {
			log('未选择cloudfunctions文件夹');
			return;
		}
		
		const cloudFunctionsPath = uri.fsPath;
		log(`已选择cloudfunctions文件夹: ${cloudFunctionsPath}`);
		
		// 检查是否已关联云空间
		if (!await checkSpaceAssociation(findCloudSpaceRoot(cloudFunctionsPath))) {
			log('未关联云空间，操作取消');
			return;
		}
		
		// 获取项目和提供商信息
		const result = await getProjectAndProviderFromAssociation(cloudFunctionsPath);
		if (result.cancelled) {
			return; // 用户取消了操作
		}
		
		// 询问是否强制覆盖
		/**
		 * @type {Array<import('vscode').QuickPickItem & {value: boolean}>}
		 */
		const overrideOptions = [
			{ label: '是', value: true, description: '强制覆盖本地资源' },
			{ label: '否', value: false, description: '不强制覆盖' }
		];
		
		const forceOverride = await vscode.window.showQuickPick(
			overrideOptions,
			{ placeHolder: '是否强制覆盖本地资源?' }
		);

		if (!forceOverride) {
			log('用户取消了强制覆盖选择');
			return;
		}
		
		// 构建下载命令
		let command = `cli cloud functions --download all --prj "${result.projectName}" --provider ${result.provider?.id || ''}`;
		
		// 如果需要强制覆盖
		if (forceOverride.value) {
			command += ' --force';
		}
		
		// 执行下载命令
		vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: '正在下载所有云函数...',
				cancellable: false
			},
			async (progress) => {
				log(`开始执行下载命令: ${command}`);
				const result = await executeCliCommand(command);
				
				if (result.success) {
					log('所有云函数下载成功!', true);
				} else {
					log(`下载失败: ${result.message}`, true);
				}
			}
		);
	});
	
	// 下载数据库Schema命令（右键菜单）
	const downloadDatabaseCmd = vscode.commands.registerCommand('unicloud-cli.downloadDatabase', async function (uri) {
		log('开始执行下载数据库Schema命令（右键菜单）');
		
		// 检查工作区
		if (!checkWorkspace()) {
			log('未找到有效的工作区');
			return;
		}
		// 检查是否关联了云空间
		if (!await checkSpaceAssociation()) {
			log('未关联云空间，操作取消');
			return;
		}
		
		// 获取选中的文件夹路径
		if (!uri || !uri.fsPath) {
			log('未选择database文件夹');
			return;
		}
		
		const databasePath = uri.fsPath;
		log(`已选择database文件夹: ${databasePath}`);
		
		// 检查是否已关联云空间
		if (!await checkSpaceAssociation(findCloudSpaceRoot(databasePath))) {
			log('未关联云空间，操作取消');
			return;
		}
		
		// 获取项目和提供商信息
		const result = await getProjectAndProviderFromAssociation(databasePath);
		if (result.cancelled) {
			return; // 用户取消了操作
		}
		
		// 询问是否强制覆盖
		/**
		 * @type {Array<import('vscode').QuickPickItem & {value: boolean}>}
		 */
		const overrideOptions = [
			{ label: '是', value: true, description: '强制覆盖本地资源' },
			{ label: '否', value: false, description: '不强制覆盖' }
		];
		
		const forceOverride = await vscode.window.showQuickPick(
			overrideOptions,
			{ placeHolder: '是否强制覆盖本地资源?' }
		);

		if (!forceOverride) {
			log('用户取消了强制覆盖选择');
			return;
		}
		
		// 构建下载命令
		let command = `cli cloud functions --download db --prj "${result.projectName}" --provider ${result.provider?.id || ''}`;
		
		// 如果需要强制覆盖
		if (forceOverride.value) {
			command += ' --force';
		}
		
		// 执行下载命令
		vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: '正在下载数据库Schema...',
				cancellable: false
			},
			async (progress) => {
				log(`开始执行下载命令: ${command}`);
				const result = await executeCliCommand(command);
				
				if (result.success) {
					log('数据库Schema下载成功!', true);
				} else {
					log(`下载失败: ${result.message}`, true);
				}
			}
		);
	});

	// 上传公共模块命令（右键菜单）
	const uploadCommonModuleCmd = vscode.commands.registerCommand('unicloud-cli.uploadCommonModule', async function (uri) {
		log('开始执行上传公共模块命令（右键菜单）');
		
		// 检查工作区
		if (!checkWorkspace()) {
			log('未找到有效的工作区');
			return;
		}
		// 检查是否关联了云空间
		if (!await checkSpaceAssociation()) {
			log('未关联云空间，操作取消');
			return;
		}
		// 获取选中的文件夹路径
		if (!uri || !uri.fsPath) {
			log('未选择公共模块文件夹');
			return;
		}
		
		const commonModulePath = uri.fsPath;
		const commonModuleName = path.basename(commonModulePath);
		log(`已选择公共模块: ${commonModuleName}, 路径: ${commonModulePath}`);
		
		// 检查是否已关联云空间
		if (!await checkSpaceAssociation(findCloudSpaceRoot(commonModulePath))) {
			log('未关联云空间，操作取消');
			return;
		}
		
		// 获取项目和提供商信息
		const result = await getProjectAndProviderFromAssociation(commonModulePath);
		if (result.cancelled) {
			return; // 用户取消了操作
		}
		
		// 询问是否强制覆盖
		/**
		 * @type {Array<import('vscode').QuickPickItem & {value: boolean}>}
		 */
		const overrideOptions = [
			{ label: '是', value: true, description: '强制覆盖现有资源' },
			{ label: '否', value: false, description: '不强制覆盖' }
		];
		
		const forceOverride = await vscode.window.showQuickPick(
			overrideOptions,
			{ placeHolder: '是否强制覆盖目标资源?' }
		);

		if (!forceOverride) {
			log('用户取消了强制覆盖选择');
			return;
		}
		
		// 构建上传命令
		let command = `cli cloud functions --upload common --prj "${result.projectName}" --provider ${result.provider?.id || ''} --name ${commonModuleName}`;
		
		// 如果需要强制覆盖
		if (forceOverride.value) {
			command += ' --force';
		}
		
		// 执行上传命令
		vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `正在上传公共模块 ${commonModuleName}...`,
				cancellable: false
			},
			async (progress) => {
				log(`开始执行上传命令: ${command}`);
				const result = await executeCliCommand(command);
				
				if (result.success) {
					log(`公共模块 ${commonModuleName} 上传成功!`, true);
				} else {
					log(`上传失败: ${result.message}`, true);
				}
			}
		);
	});
	
	// 本地运行云函数命令（右键菜单）
	const runCloudFunctionCmd = vscode.commands.registerCommand('unicloud-cli.runCloudFunction', async function (uri) {
		log('开始执行本地运行云函数命令（右键菜单）');
		
		// 检查工作区
		if (!checkWorkspace()) {
			log('未找到有效的工作区');
			return;
		}
		// 检查是否关联了云空间
		if (!await checkSpaceAssociation()) {
			log('未关联云空间，操作取消');
			return;
		}
		
		// 获取选中的文件路径
		if (!uri || !uri.fsPath) {
			log('未选择云函数入口文件');
			return;
		}
		
		const indexFilePath = uri.fsPath;
		// 获取云函数名称（所在文件夹名称）
		const cloudFunctionName = path.basename(path.dirname(indexFilePath));
		log(`已选择云函数入口文件: ${indexFilePath}, 云函数名称: ${cloudFunctionName}`);
		
		// 检查是否已关联云空间
		if (!await checkSpaceAssociation(findCloudSpaceRoot(indexFilePath))) {
			log('未关联云空间，操作取消');
			return;
		}
		
		// 获取项目和提供商信息
		const result = await getProjectAndProviderFromAssociation(indexFilePath);
		if (result.cancelled) {
			return; // 用户取消了操作
		}
		
		// 询问运行参数
		const params = await vscode.window.showInputBox({
			placeHolder: '输入云函数参数，JSON格式 (可选)',
			prompt: '请输入云函数调用参数（JSON格式）',
			value: '{}'
		});
		
		if (params === undefined) {
			log('用户取消了参数输入');
			return;
		}
		
		let validParams = params;
		// 验证JSON格式
		try {
			if (params && params.trim()) {
				JSON.parse(params);
			} else {
				validParams = '{}';
			}
		} catch (error) {
			log(`JSON参数格式错误: ${error.message}`, true);
			return;
		}
		
		// 构建运行命令
		let command = `cli cloud functions --run ${cloudFunctionName} --prj "${result.projectName}" --provider ${result.provider?.id || ''} --params ${validParams.replace(/"/g, '\\"')}`;
		
		// 创建输出通道以显示运行结果
		const outputChannel = initOutputChannel();
		outputChannel.clear();
		outputChannel.appendLine(`正在本地运行云函数 ${cloudFunctionName}...`);
		outputChannel.appendLine(`参数: ${validParams}`);
		outputChannel.show();
		
		// 执行运行命令
		vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `正在运行云函数 ${cloudFunctionName}...`,
				cancellable: false
			},
			async (progress) => {
				log(`开始执行运行命令: ${command}`);
				const result = await executeCliCommand(command);
				
				if (result.success) {
					outputChannel.appendLine('运行结果:');
					outputChannel.appendLine(result.message);
					log(`云函数 ${cloudFunctionName} 运行成功!`, true);
				} else {
					outputChannel.appendLine('运行错误:');
					outputChannel.appendLine(result.message);
					log(`运行失败: ${result.message}`, true);
				}
			}
		);
	});

	// 查找路径所属的云空间主文件夹
	function findCloudSpaceRoot(filePath) {
		// 如果是云函数文件夹，向上查找
		const pathParts = filePath.split(path.sep);
		
		// 查找uniCloud-aliyun或uniCloud-tcb目录
		for (let i = pathParts.length - 1; i >= 0; i--) {
			if (pathParts[i] === 'uniCloud-aliyun' || pathParts[i] === 'uniCloud-tcb' || pathParts[i] === 'uniCloud-alipay') {
				// 找到云空间根目录，返回完整路径
				return pathParts.slice(0, i + 1).join(path.sep);
			}
		}
		
		// 如果没找到，返回原路径
		return filePath;
	}

	// 从路径获取云服务商类型
	function getProviderTypeFromPath(filePath) {
		if (filePath.includes('uniCloud-aliyun')) {
			return 'aliyun';
		} else if (filePath.includes('uniCloud-tcb')) {
			return 'tcb';
		} else if (filePath.includes('uniCloud-alipay')) {
			return 'alipay';
		}
		return null;
	}

	// 从云空间关联中获取或选择项目和提供商
	async function getProjectAndProviderFromAssociation(filePath) {
		// 如果提供了文件路径，先尝试获取对应云空间的关联信息
		let preferredProvider = null;
		if (filePath) {
			const spaceRoot = findCloudSpaceRoot(filePath);
			const providerType = getProviderTypeFromPath(filePath);
			
			if (providerType) {
				log(`检测到路径 ${filePath} 属于 ${providerType} 云空间，根目录: ${spaceRoot}`);
				
				// 获取云空间配置信息
				const spaceConfig = getSpaceConfig();
				if (spaceConfig[providerType]) {
					preferredProvider = {
						id: providerType,
						label: providerType === 'aliyun' ? '阿里云' : providerType === 'tcb' ? '腾讯云' : '支付宝',
						spaceInfo: spaceConfig[providerType]
					};
					log(`找到匹配的云空间关联: ${providerType}`);
				}
			}
		}
		
		// 获取云空间配置信息
		const spaceConfig = getSpaceConfig();
		const providers = Object.keys(spaceConfig);
		
		let projectName = '';
		let selectedProvider = null;
		
		// 如果有从路径中推断出的关联信息，优先使用
		if (preferredProvider) {
			selectedProvider = preferredProvider;
			if (preferredProvider.spaceInfo && preferredProvider.spaceInfo.projectName) {
				projectName = preferredProvider.spaceInfo.projectName;
				log(`自动使用路径匹配的云空间关联，项目: ${projectName}`);
			}
		}
		// 否则，处理云服务商信息
		else if (providers.length === 1) {
			// 只有一个关联的云服务商，直接使用
			const providerId = providers[0];
			const config = spaceConfig[providerId];
			selectedProvider = {
				id: providerId,
				label: providerId === 'aliyun' ? '阿里云' : providerId === 'tcb' ? '腾讯云' : '支付宝',
				spaceInfo: config
			};
			log(`自动使用已关联的云服务商: ${providerId}`);
			
			// 同时获取项目名称
			if (config.projectName) {
				projectName = config.projectName;
				log(`自动使用关联的项目: ${projectName}`);
			}
		} else if (providers.length > 1) {
			// 有多个关联的云服务商，让用户选择
			selectedProvider = await getOrSelectProvider();
			if (!selectedProvider) {
				log('用户取消了云服务商选择');
				return { cancelled: true };
			}
			
			// 获取选中云服务商的项目信息
			if (selectedProvider && 'spaceInfo' in selectedProvider && selectedProvider.spaceInfo && selectedProvider.spaceInfo.projectName) {
				projectName = selectedProvider.spaceInfo.projectName;
				log(`使用关联的项目: ${projectName}`);
			}
		} else {
			// 没有关联的云服务商，需要选择
			// 获取项目列表
			const projects = await getProjectList();
			if (projects.length === 0) {
				log('未找到可用项目', true);
				return { cancelled: true };
			}
			
			// 选择项目
			if (projects.length === 1) {
				// 只有一个项目，直接使用
				projectName = projects[0].name;
				log(`只有一个可用项目，自动使用: ${projectName}`);
			} else {
				// 多个项目，让用户选择
				const selectedProject = await vscode.window.showQuickPick(
					projects.map(p => ({ 
						label: p.name, 
						id: p.id,
						name: p.name,
						description: `项目ID: ${p.id}`
					})),
					{ placeHolder: '请选择项目' }
				);

				if (!selectedProject) {
					log('用户取消了项目选择');
					return { cancelled: true };
				}
				projectName = selectedProject.name;
				log(`已选择项目: ${projectName}`);
			}
			
			// 选择云服务商
			selectedProvider = await selectProvider();
			if (!selectedProvider) {
				log('用户取消了云服务商选择');
				return { cancelled: true };
			}
			log(`已选择云服务商: ${selectedProvider.label}`);
		}
		
		// 如果需要但仍然没有项目名称，获取项目列表
		if (!projectName) {
			const projects = await getProjectList();
			if (projects.length === 0) {
				log('未找到可用项目', true);
				return { cancelled: true };
			} else if (projects.length === 1) {
				// 只有一个项目，直接使用
				projectName = projects[0].name;
				log(`自动使用项目: ${projectName}`);
			} else {
				// 多个项目，让用户选择
				const selectedProject = await vscode.window.showQuickPick(
					projects.map(p => ({ 
						label: p.name, 
						id: p.id,
						name: p.name,
						description: `项目ID: ${p.id}`
					})),
					{ placeHolder: '请选择项目' }
				);

				if (!selectedProject) {
					log('用户取消了项目选择');
					return { cancelled: true };
				}
				projectName = selectedProject.name;
				log(`已选择项目: ${projectName}`);
			}
		}
		
		return {
			projectName,
			provider: selectedProvider,
			cancelled: false
		};
	}

	context.subscriptions.push(disposable);
	context.subscriptions.push(uploadFunctionCmd);
	context.subscriptions.push(downloadFunctionCmd);
	context.subscriptions.push(listResourcesCmd);
	context.subscriptions.push(initDatabaseCmd);
	context.subscriptions.push(assignSpaceCmd);
	context.subscriptions.push(linkFolderToSpaceCmd);
	context.subscriptions.push(configureCLIPathCmd);
	context.subscriptions.push(manageSpaceAssociationsCmd);
	context.subscriptions.push(uploadSingleCloudFunctionCmd);
	context.subscriptions.push(uploadAllCloudFunctionsCmd);
	context.subscriptions.push(uploadDatabaseCmd);
	context.subscriptions.push(downloadSingleCloudFunctionCmd);
	context.subscriptions.push(downloadAllCloudFunctionsCmd);
	context.subscriptions.push(downloadDatabaseCmd);
	context.subscriptions.push(uploadCommonModuleCmd);
	context.subscriptions.push(runCloudFunctionCmd);
}

// 加载已关联的云空间文件夹
function loadAssociatedCloudFolders() {
	try {
		const config = vscode.workspace.getConfiguration('unicloud-cli');
		const spaceAssociations = config.get('spaceAssociations') || {};
		
		// 清空现有列表
		associatedCloudFolders = [];
		
		// 添加所有关联的文件夹路径
		for (const providerId in spaceAssociations) {
			const spaceInfo = spaceAssociations[providerId];
			if (spaceInfo.folderPath) {
				associatedCloudFolders.push(spaceInfo.folderPath);
			}
		}
		
		log(`已加载 ${associatedCloudFolders.length} 个关联的云空间文件夹`);
	} catch (error) {
		log(`加载关联的云空间文件夹失败: ${error.message}`);
	}
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
