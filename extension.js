// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const iconv = require('iconv-lite'); // 注意：需要安装这个包

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

	// 获取云服务商选择
	async function selectProvider() {
		/**
		 * @type {Array<import('vscode').QuickPickItem & {id: string}>}
		 */
		const providers = [
			{ label: '阿里云', id: 'aliyun', description: '阿里云服务' },
			{ label: '腾讯云', id: 'tcb', description: '腾讯云服务' }
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
		const selectedProvider = await selectProvider();
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

	// 上传云函数命令
	const uploadFunctionCmd = vscode.commands.registerCommand('unicloud-cli.uploadCloudFunction', async function () {
		log('开始执行上传云函数命令');
		
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

		const selectedProvider = await selectProvider();
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

		const selectedProvider = await selectProvider();
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

		const selectedProvider = await selectProvider();
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

		const selectedProvider = await selectProvider();
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

		const selectedProvider = await selectProvider();
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

		// 创建或更新关联配置文件
		try {
			// 确保目标文件夹是uniCloud项目文件夹
			const uniCloudConfigPath = path.join(folderPath, 'uniCloud.config.js');
			
			// 检查是否已存在相关配置
			let configContent = '';
			let existingConfig = {};
			
			if (fs.existsSync(uniCloudConfigPath)) {
				log(`发现已存在的uniCloud配置文件: ${uniCloudConfigPath}`);
				try {
					// 读取现有配置
					const configFileContent = fs.readFileSync(uniCloudConfigPath, 'utf8');
					
					// 提取配置对象
					const configMatch = configFileContent.match(/module\.exports\s*=\s*({[\s\S]*})/);
					if (configMatch && configMatch[1]) {
						// 这里使用了一种简单的方式来解析配置，实际项目中可能需要更复杂的处理
						try {
							// 警告：eval可能有安全隐患，仅用于演示
							existingConfig = eval(`(${configMatch[1]})`);
							log(`解析现有配置: ${JSON.stringify(existingConfig)}`);
						} catch (evalError) {
							log(`解析配置对象失败: ${evalError.message}`);
						}
					}
				} catch (readError) {
					log(`读取配置文件失败: ${readError.message}`);
				}
			}
			
			// 更新配置对象
			const updatedConfig = {
				...existingConfig,
				[selectedProvider.id]: {
					spaceId: selectedSpace.id,
					spaceName: selectedSpace.spaceName,
					provider: selectedProvider.id
				}
			};
			
			// 生成配置文件内容
			configContent = `// uniCloud项目配置\nmodule.exports = ${JSON.stringify(updatedConfig, null, 2)}`;
			
			// 写入配置文件
			fs.writeFileSync(uniCloudConfigPath, configContent);
			
			log(`成功关联文件夹 "${folderPath}" 到云空间 "${selectedSpace.spaceName}"`, true);
		} catch (error) {
			log(`关联文件夹到云空间失败: ${error.message}`, true);
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

	context.subscriptions.push(disposable);
	context.subscriptions.push(uploadFunctionCmd);
	context.subscriptions.push(downloadFunctionCmd);
	context.subscriptions.push(listResourcesCmd);
	context.subscriptions.push(initDatabaseCmd);
	context.subscriptions.push(assignSpaceCmd);
	context.subscriptions.push(linkFolderToSpaceCmd);
	context.subscriptions.push(configureCLIPathCmd);
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
