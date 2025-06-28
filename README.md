# UniCloud CLI

VSCode扩展，提供了HBuilderX的UniCloud云函数管理命令支持，使您能在VSCode中直接使用UniCloud CLI功能。

## 功能特性

- **云函数管理**：上传、下载、本地运行云函数
- **数据库管理**：上传Schema、初始化数据库
- **云服务商关联**：支持阿里云和腾讯云
- **文件资源管理器集成**：在资源管理器中右键操作云函数和数据库
- **配置无侵入**：将云空间关联信息保存在VSCode工作区设置中，不污染项目文件

## 安装要求

- VSCode 1.101.0 或更高版本
- HBuilderX CLI工具

## 快速开始

1. 配置HBuilderX CLI路径
   - 使用命令面板（Ctrl+Shift+P）运行 `UniCloud: 配置CLI路径`

2. 关联云空间
   - 在资源管理器中，右键点击项目文件夹，选择 `UniCloud: 关联文件夹到云空间`
   - 或使用命令面板运行 `UniCloud: 关联文件夹到云空间`

3. 上传/下载云函数
   - 在资源管理器中，右键点击云函数文件夹，选择上传或下载操作
   - 或使用命令面板运行相应的命令

## 可用命令

- **UniCloud: 上传资源** - 上传单个或全部资源
- **UniCloud: 下载资源** - 下载单个或全部资源
- **UniCloud: 列举资源信息** - 显示云端或本地资源信息
- **UniCloud: 初始化数据库** - 初始化云数据库
- **UniCloud: 指定云空间** - 为当前项目指定云空间
- **UniCloud: 关联文件夹到云空间** - 将文件夹关联到云空间
- **UniCloud: 配置CLI路径** - 配置HBuilderX CLI工具路径
- **UniCloud: 管理云空间关联** - 管理工作区中的云空间关联信息

## 右键菜单功能

在VSCode资源管理器中：
- 云函数文件夹右键菜单：上传/下载此云函数
- cloudfunctions文件夹右键菜单：上传/下载所有云函数
- database文件夹右键菜单：上传/下载数据库Schema
- 云函数index.js文件右键菜单：本地运行云函数
- 公共模块文件夹右键菜单：上传此公共模块

## 配置选项

| 选项名 | 描述 | 默认值 |
| ------ | ---- | ------ |
| unicloud-cli.cliPath | HBuilderX CLI工具的路径 | C:\\Program Files\\HBuilderX\\cli.exe |
| unicloud-cli.spaceAssociations | 云空间关联信息 | {} |
